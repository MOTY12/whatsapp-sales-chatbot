import { redirect } from 'next/navigation';
import {
  ApiError,
  api,
  type ProductPage as ProductPageResult,
} from '@/lib/api';
import { BusinessPicker } from '@/components/business-picker';
import { ProductExperience } from './product-experience';

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ businessId?: string }>;
}) {
  const { businessId: requested } = await searchParams;
  let identity;
  try {
    identity = await api.identity();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    redirect('/login?error=unavailable');
  }
  const memberships = identity.memberships.filter(
    ({ role }) => role === 'owner' || role === 'editor',
  );
  if (!memberships.length)
    return (
      <section className="empty-card">
        <h1>Product access required</h1>
        <p>
          Your business owner can grant product editing to an owner or editor.
        </p>
      </section>
    );
  if (
    requested &&
    !memberships.some(({ businessId }) => businessId === requested)
  )
    redirect('/dashboard/products');
  const membership =
    memberships.find(({ businessId }) => businessId === requested) ??
    memberships[0];
  let choices: { id: string; name: string }[];
  try {
    choices = await Promise.all(
      memberships.map(async ({ businessId }) => {
        const business = await api.business(businessId);
        return { id: businessId, name: business.name };
      }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    choices = memberships.map(({ businessId }) => ({
      id: businessId,
      name: 'Business workspace',
    }));
  }
  let initial: ProductPageResult = {
    items: [],
    limit: 50,
    offset: 0,
    hasMore: false,
  };
  let initialError: string | null = null;
  try {
    initial = await api.products(membership.businessId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    initialError =
      error instanceof ApiError
        ? error.message
        : 'The product catalog could not be loaded. Try again.';
  }
  return (
    <div className="knowledge-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR BUSINESS CATALOG</div>
          <h1>Products</h1>
          <p className="muted">
            Maintain approved product details. Missing price and stock stay
            unknown.
          </p>
        </div>
        {choices.length > 1 && (
          <BusinessPicker
            action="/dashboard/products"
            current={membership.businessId}
            choices={choices}
          />
        )}
      </div>
      <ProductExperience
        key={membership.businessId}
        businessId={membership.businessId}
        initialPage={initial}
        initialError={initialError}
      />
    </div>
  );
}
