import { redirect } from 'next/navigation';
import { ApiError, api, type MerchantLead } from '@/lib/api';
import { BusinessPicker } from '@/components/business-picker';
import { LeadsExperience } from './leads-experience';
export default async function LeadsPage({searchParams}:{searchParams:Promise<{businessId?:string}>}){
 const {businessId:requested}=await searchParams;let identity;try{identity=await api.identity();}catch(error){if(error instanceof ApiError&&error.status===401)redirect('/login?error=session');redirect('/login?error=unavailable');}
 const memberships=identity.memberships.filter(({role})=>role==='owner'||role==='agent');if(!memberships.length)return <section className="empty-card"><h1>Lead access required</h1><p>Your business owner can grant inbox access to an owner or agent.</p></section>;
 if(requested&&!memberships.some(({businessId})=>businessId===requested))redirect('/dashboard/leads');const member=memberships.find(({businessId})=>businessId===requested)??memberships[0];
 const choices=await Promise.all(memberships.map(async({businessId})=>{try{return{id:businessId,name:(await api.business(businessId)).name};}catch{return{id:businessId,name:'Business workspace'};}}));
 let leads:MerchantLead[]=[];let error:string|null=null;try{leads=(await api.leads(member.businessId)).items;}catch(e){if(e instanceof ApiError&&e.status===401)redirect('/login?error=session');error=e instanceof ApiError?e.message:'Leads could not be loaded. Try again.';}
 return <div className="knowledge-page"><div className="page-heading"><div><div className="eyebrow">SALES FOLLOW-UP</div><h1>Leads</h1><p className="muted">Track customers who start a WhatsApp conversation.</p></div>{choices.length>1&&<BusinessPicker action="/dashboard/leads" current={member.businessId} choices={choices}/>}</div><LeadsExperience key={member.businessId} businessId={member.businessId} initialLeads={leads} initialError={error}/></div>;
}
