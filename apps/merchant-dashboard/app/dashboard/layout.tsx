import { redirect } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { MerchantShell } from '@/components/merchant-shell';

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let identity;
  try { identity = await api.identity(); }
  catch (error) { if (error instanceof ApiError && error.status === 401) redirect('/login?error=session'); redirect('/login?error=unavailable'); }
  const businessId = identity.memberships[0]?.businessId;
  let businessName = 'Your business';
  if (businessId) {
    try { businessName = (await api.business(businessId)).name; }
    catch (error) { if (error instanceof ApiError && error.status === 401) redirect('/login?error=session'); }
  }
  return <MerchantShell businessName={businessName} active="/dashboard">{children}</MerchantShell>;
}
