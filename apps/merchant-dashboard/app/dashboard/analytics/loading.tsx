import styles from './analytics.module.css';

export default function AnalyticsLoading() {
  return (
    <div
      className={styles.page}
      aria-busy="true"
      aria-label="Loading analytics"
    >
      <div className={styles.skeletonHeading} />
      <div className={styles.skeletonFilters} />
      <div className={styles.skeletonMetrics}>
        {Array.from({ length: 6 }, (_, index) => (
          <div className={styles.skeletonCard} key={index} />
        ))}
      </div>
      <div className={styles.skeletonGrid}>
        {Array.from({ length: 4 }, (_, index) => (
          <div className={styles.skeletonCard} key={index} />
        ))}
      </div>
    </div>
  );
}
