'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MerchantProduct, ProductDraft, ProductPage } from '@/lib/api';
import styles from '../knowledge/knowledge.module.css';

type Props = {
  businessId: string;
  initialPage: ProductPage;
  initialError: string | null;
};
type ApiFailure = { error?: { message?: string } };
type Fields = {
  name: string;
  description: string;
  sku: string;
  price: string;
  currency: string;
  availability: ProductDraft['availability'];
};
const blank: Fields = {
  name: '',
  description: '',
  sku: '',
  price: '',
  currency: 'NGN',
  availability: 'UNKNOWN',
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.method && init.method !== 'GET') {
    const csrf = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('kleva_csrf='));
    if (csrf)
      headers.set(
        'X-CSRF-Token',
        decodeURIComponent(csrf.slice(csrf.indexOf('=') + 1)),
      );
  }
  const response = await fetch(path, { ...init, headers, cache: 'no-store' });
  if (response.status === 401) {
    window.dispatchEvent(new Event('kleva-session-expired'));
    throw new Error('Your session expired. Sign in again.');
  }
  if (!response.ok) {
    const failure = (await response
      .json()
      .catch(() => null)) as ApiFailure | null;
    throw new Error(
      failure?.error?.message ??
        'The product catalog could not be updated. Try again.',
    );
  }
  return response.json() as Promise<T>;
}

function fieldsFrom(product: MerchantProduct): Fields {
  return {
    name: product.name,
    description: product.description,
    sku: product.sku ?? '',
    price: product.price ?? '',
    currency: product.currency,
    availability: product.availability,
  };
}

function availabilityLabel(value: Fields['availability']) {
  if (value === 'IN_STOCK') return 'In stock';
  if (value === 'OUT_OF_STOCK') return 'Out of stock';
  return 'Availability unknown';
}

function validate(fields: Fields) {
  if (!fields.name.trim()) return 'Add a product name before saving.';
  if (fields.name.trim().length > 160)
    return 'Keep the name under 160 characters.';
  if (fields.description.length > 4000)
    return 'Keep the description under 4,000 characters.';
  if (fields.sku.trim().length > 100)
    return 'Keep the SKU under 100 characters.';
  if (
    fields.price.trim() &&
    !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(fields.price.trim())
  )
    return 'Enter a non-negative price with up to two decimal places.';
  return null;
}

function draft(fields: Fields): ProductDraft {
  return {
    name: fields.name.trim(),
    description: fields.description.trim(),
    sku: fields.sku.trim() || null,
    price: fields.price.trim() || null,
    currency: fields.currency,
    availability: fields.availability,
  };
}

function insertPage(current: MerchantProduct[], incoming: MerchantProduct[]) {
  const ids = new Set(current.map(({ id }) => id));
  return [...current, ...incoming.filter(({ id }) => !ids.has(id))];
}

export function ProductExperience({
  businessId,
  initialPage,
  initialError,
}: Props) {
  const router = useRouter();
  const [products, setProducts] = useState(initialPage.items);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialPage.items[0]?.id ?? null,
  );
  const [fields, setFields] = useState(
    initialPage.items[0] ? fieldsFrom(initialPage.items[0]) : blank,
  );
  const [filter, setFilter] = useState<'ALL' | 'DRAFT' | 'PUBLISHED'>('ALL');
  const [search, setSearch] = useState('');
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [mobileEditorOpen, setMobileEditorOpen] = useState(
    Boolean(initialPage.items[0]),
  );
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const createKey = useRef<{ signature: string; key: string } | null>(null);
  const selected = products.find(({ id }) => id === selectedId) ?? null;
  const isDirty = selected
    ? JSON.stringify(fields) !== JSON.stringify(fieldsFrom(selected))
    : JSON.stringify(fields) !== JSON.stringify(blank);
  const visible = useMemo(
    () =>
      products.filter((product) => {
        if (filter !== 'ALL' && product.status !== filter) return false;
        const needle = search.trim().toLocaleLowerCase();
        return (
          !needle ||
          `${product.name} ${product.description} ${product.sku ?? ''}`
            .toLocaleLowerCase()
            .includes(needle)
        );
      }),
    [filter, products, search],
  );

  useEffect(() => {
    const onSessionExpired = () => router.push('/login?error=session');
    window.addEventListener('kleva-session-expired', onSessionExpired);
    return () =>
      window.removeEventListener('kleva-session-expired', onSessionExpired);
  }, [router]);

  function select(product: MerchantProduct) {
    setSelectedId(product.id);
    setFields(fieldsFrom(product));
    setError(null);
    setNotice(null);
    setConfirmUnpublish(false);
    setMobileEditorOpen(true);
  }

  function createNew() {
    setSelectedId(null);
    setFields(blank);
    setError(null);
    setNotice(null);
    setConfirmUnpublish(false);
    setMobileEditorOpen(true);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = validate(fields);
    if (invalid) {
      setError(invalid);
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      let saved: MerchantProduct;
      if (!selected) {
        const data = draft(fields);
        const signature = JSON.stringify(data);
        const key =
          createKey.current?.signature === signature
            ? createKey.current.key
            : window.crypto.randomUUID();
        createKey.current = { signature, key };
        saved = await requestJson<MerchantProduct>(
          `/api/products/${businessId}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': key,
            },
            body: JSON.stringify(data),
          },
        );
        createKey.current = null;
        setNotice(
          'Draft saved. It stays hidden from customers until published.',
        );
      } else {
        saved = await requestJson<MerchantProduct>(
          `/api/products/${businessId}/${selected.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...draft(fields),
              expectedRevision: selected.revision,
            }),
          },
        );
        setNotice(
          saved.has_unpublished_changes
            ? 'Draft saved. The published product stays live until you publish this revision.'
            : 'Draft saved.',
        );
      }
      setProducts((current) => [
        saved,
        ...current.filter(({ id }) => id !== saved.id),
      ]);
      setSelectedId(saved.id);
      setFields(fieldsFrom(saved));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not save product.',
      );
    } finally {
      setPending(false);
    }
  }

  async function changePublication(publish: boolean) {
    if (!selected) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await requestJson<MerchantProduct>(
        `/api/products/${businessId}/${selected.id}/${publish ? 'publish' : 'unpublish'}`,
        { method: 'POST' },
      );
      setProducts((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelectedId(updated.id);
      setFields(fieldsFrom(updated));
      setConfirmUnpublish(false);
      setNotice(publish ? 'Product published.' : 'Product unpublished.');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not update publication.',
      );
    } finally {
      setPending(false);
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    setError(null);
    try {
      const page = await requestJson<ProductPage>(
        `/api/products/${businessId}?limit=50&offset=${products.length}`,
      );
      setProducts((current) => insertPage(current, page.items));
      setHasMore(page.hasMore);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not load more products.',
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section
      className={styles.workspace}
      aria-label="Product catalog management"
    >
      <aside
        className={`${styles.listPanel} ${mobileEditorOpen ? styles.mobileHidden : ''}`}
      >
        <div className={styles.listHeading}>
          <div>
            <h2>Catalog</h2>
            <p>Approved products and services</p>
          </div>
          <span className={styles.total}>{products.length}</span>
        </div>
        <button
          className="button button-primary"
          type="button"
          onClick={createNew}
        >
          + New product
        </button>
        <label className={styles.searchLabel} htmlFor="product-search">
          Search catalog
        </label>
        <input
          className={styles.search}
          id="product-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search products"
        />
        <div
          className={styles.filters}
          role="group"
          aria-label="Filter products"
        >
          {(['ALL', 'DRAFT', 'PUBLISHED'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === 'ALL'
                ? 'All'
                : value === 'DRAFT'
                  ? 'Drafts'
                  : 'Published'}
            </button>
          ))}
        </div>
        {error && !selected && (
          <div className={styles.listState} role="alert">
            <p>{error}</p>
          </div>
        )}
        {visible.length ? (
          <div className={styles.faqList}>
            {visible.map((product) => (
              <button
                key={product.id}
                type="button"
                className={`${styles.faqItem} ${selectedId === product.id ? styles.selected : ''}`}
                onClick={() => select(product)}
                aria-current={selectedId === product.id ? 'true' : undefined}
              >
                <span className={styles.itemHeading}>
                  <strong>{product.name}</strong>
                  <span
                    className={`${styles.badge} ${product.status === 'PUBLISHED' ? styles.published : ''}`}
                  >
                    {product.status === 'PUBLISHED' ? 'Published' : 'Draft'}
                  </span>
                </span>
                <span className={styles.itemAnswer}>
                  {product.price === null
                    ? 'Price not set'
                    : `${product.currency} ${product.price}`}{' '}
                  · {availabilityLabel(product.availability)}
                </span>
                {product.has_unpublished_changes && (
                  <span className={styles.unpublishedHint}>
                    Unpublished changes
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.listState}>
            <strong>
              {search || filter !== 'ALL'
                ? 'No matching products'
                : 'No products yet'}
            </strong>
            <p>
              {search || filter !== 'ALL'
                ? 'Change your search or filter.'
                : 'Add a product. It will remain a draft until you publish it.'}
            </p>
          </div>
        )}
        {hasMore && (
          <button
            className="button button-secondary"
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </aside>

      <div
        className={`${styles.editorPanel} ${mobileEditorOpen ? styles.mobileEditorOpen : ''}`}
      >
        <div className={styles.editorHeading}>
          <button
            type="button"
            className={styles.backButton}
            onClick={() => setMobileEditorOpen(false)}
          >
            ← Catalog
          </button>
          <div>
            <div className="eyebrow">PRODUCT DETAILS</div>
            <h2>{selected ? 'Edit product' : 'Create product'}</h2>
            <p>Missing price or availability is kept explicitly unknown.</p>
          </div>
        </div>
        {selected && (
          <div className={styles.metadata}>
            <span
              className={`${styles.badge} ${selected.status === 'PUBLISHED' ? styles.published : ''}`}
            >
              {selected.status}
            </span>
            <span>Revision {selected.revision}</span>
            {selected.published_revision && (
              <span>Published revision {selected.published_revision}</span>
            )}
          </div>
        )}
        {selected?.has_unpublished_changes && (
          <div className={styles.reviewNotice} role="status">
            <strong>Unpublished changes awaiting review.</strong> Customers
            still see the last published revision.
          </div>
        )}
        {selected?.status === 'PUBLISHED' &&
          !selected.has_unpublished_changes && (
            <div className={styles.liveNotice} role="status">
              Published product information is available to customer retrieval.
            </div>
          )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className={styles.success} role="status">
            {notice}
          </p>
        )}
        <form className={styles.editorForm} onSubmit={save}>
          <label htmlFor="product-name">
            Product name <span>Required</span>
          </label>
          <input
            id="product-name"
            maxLength={160}
            value={fields.name}
            onChange={(event) =>
              setFields((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="For example: Classic leather handbag"
          />
          <small>{fields.name.length} / 160 characters</small>
          <label htmlFor="product-description">
            Description <span>Optional</span>
          </label>
          <textarea
            id="product-description"
            maxLength={4000}
            rows={5}
            value={fields.description}
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            placeholder="Approved product facts in plain text"
          />
          <small>
            {fields.description.length.toLocaleString()} / 4,000 characters
          </small>
          <label htmlFor="product-sku">
            SKU <span>Optional</span>
          </label>
          <input
            id="product-sku"
            maxLength={100}
            value={fields.sku}
            onChange={(event) =>
              setFields((current) => ({ ...current, sku: event.target.value }))
            }
            placeholder="Merchant SKU"
          />
          <label htmlFor="product-price">
            Price <span>Optional; blank means unknown</span>
          </label>
          <div className={styles.priceRow}>
            <input
              id="product-price"
              inputMode="decimal"
              value={fields.price}
              onChange={(event) =>
                setFields((current) => ({
                  ...current,
                  price: event.target.value,
                }))
              }
              placeholder="0.00"
              aria-describedby="product-price-help"
            />
            <select
              aria-label="Price currency"
              value={fields.currency}
              onChange={(event) =>
                setFields((current) => ({
                  ...current,
                  currency: event.target.value,
                }))
              }
            >
              {[
                'NGN',
                'USD',
                'GBP',
                'EUR',
                'GHS',
                'KES',
                'ZAR',
                'CAD',
                'AUD',
              ].map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>
          <small id="product-price-help">
            Use a decimal amount; up to two decimal places. Price is never
            inferred from the description.
          </small>
          <label htmlFor="product-availability">Availability</label>
          <select
            id="product-availability"
            value={fields.availability}
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                availability: event.target.value as Fields['availability'],
              }))
            }
          >
            <option value="UNKNOWN">Unknown</option>
            <option value="IN_STOCK">In stock</option>
            <option value="OUT_OF_STOCK">Out of stock</option>
          </select>
          <div className={styles.safetyNote}>
            <span aria-hidden="true">ⓘ</span>
            <p>
              Only the published revision is returned to future customer
              retrieval. Product text is displayed literally; HTML is not
              executed.
            </p>
          </div>
          <div className={styles.actions}>
            <div>
              <p>
                {selected?.status === 'PUBLISHED' && isDirty
                  ? 'The published product stays unchanged until you publish these edits.'
                  : 'Save a draft, then publish it when the product details are approved.'}
              </p>
            </div>
            <div className={styles.actionButtons}>
              <button
                className="button button-secondary"
                type="submit"
                disabled={pending || !isDirty}
              >
                {pending ? 'Saving…' : 'Save draft'}
              </button>
              {selected?.status === 'PUBLISHED' &&
              !selected.has_unpublished_changes ? (
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={pending || isDirty}
                  onClick={() => setConfirmUnpublish(true)}
                >
                  Unpublish
                </button>
              ) : selected?.status === 'PUBLISHED' &&
                selected.has_unpublished_changes ? (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={pending || isDirty}
                  onClick={() => void changePublication(true)}
                >
                  {pending ? 'Publishing…' : 'Publish updates'}
                </button>
              ) : (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={pending || isDirty}
                  onClick={() => void changePublication(true)}
                >
                  {pending ? 'Publishing…' : 'Publish product'}
                </button>
              )}
            </div>
          </div>
        </form>
        {confirmUnpublish && (
          <div
            className={styles.confirmation}
            role="group"
            aria-label="Confirm unpublishing product"
          >
            <p>
              This removes the product from future customer retrieval. Existing
              revisions remain in history.
            </p>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setConfirmUnpublish(false)}
            >
              Keep published
            </button>
            <button
              className="button button-primary"
              type="button"
              disabled={pending}
              onClick={() => void changePublication(false)}
            >
              Confirm unpublish
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
