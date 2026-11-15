import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { MerchantPrincipal } from './auth.service';
import { MerchantAccess } from './merchant-access.service';

type Cursor = { at: string; id: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = ['NEW','CONTACTED','QUALIFIED','WON','LOST'] as const;
type LeadRow = { id:string; customer_id:string; conversation_id:string; customer_name:string; customer_whatsapp_id:string; source:string; status:(typeof statuses)[number]; first_contact_at:Date|string; last_activity_at:Date|string; version:string|number; updated_at:Date|string };
const encode=(v:Cursor)=>Buffer.from(JSON.stringify(v)).toString('base64url');
function decode(value?:string):Cursor|undefined { if(!value)return; try {const v=JSON.parse(Buffer.from(value,'base64url').toString()) as Cursor;if(!v||!uuid.test(v.id)||!Number.isFinite(Date.parse(v.at)))throw 0;return {id:v.id,at:new Date(v.at).toISOString()};}catch{throw new BadRequestException('Invalid pagination cursor.');}}
function lead(value:string){if(!uuid.test(value))throw new NotFoundException();}
@Injectable()
export class MerchantLeadsService {
  constructor(private readonly access:MerchantAccess){}
  list(actor:MerchantPrincipal,businessId:string,limit?:string,cursor?:string,status?:string){
    const size=limit===undefined?30:/^\d{1,3}$/.test(limit)?Math.min(100,Math.max(1,Number(limit))):NaN;
    if(!Number.isFinite(size))throw new BadRequestException('Invalid page size.');
    if(status && !(statuses as readonly string[]).includes(status))throw new BadRequestException('Invalid lead status.');
    const page=decode(cursor);
    return this.access.withBusiness(actor,businessId,'inbox.operate',async manager=>{
      const rows=await manager.query<LeadRow[]>('SELECT * FROM public.kleva_leads_list($1,$2,$3,$4)',[size+1,page?.at??null,page?.id??null,status??null]);
      const hasMore=rows.length>size,items=rows.slice(0,size).map(this.serialize);
      return {items,nextCursor:hasMore&&items.length?encode({at:new Date(items.at(-1)!.last_activity_at).toISOString(),id:items.at(-1)!.id}):null};
    });
  }
  detail(actor:MerchantPrincipal,businessId:string,leadId:string){lead(leadId);return this.access.withBusiness(actor,businessId,'inbox.operate',async manager=>{const [row]=await manager.query<LeadRow[]>('SELECT * FROM public.kleva_lead_detail($1)',[leadId]);if(!row)throw new NotFoundException();return this.serialize(row);});}
  async update(actor:MerchantPrincipal,businessId:string,leadId:string,body:unknown){
    lead(leadId);if(!body||typeof body!=='object')throw new BadRequestException('Invalid status update.');
    const {status,expectedVersion}=body as {status?:unknown;expectedVersion?:unknown};
    if(typeof status!=='string'||!(statuses as readonly string[]).includes(status)||!Number.isSafeInteger(expectedVersion)||Number(expectedVersion)<1)throw new BadRequestException('Invalid status update.');
    return this.access.withBusiness(actor,businessId,'inbox.operate',async manager=>{
      try {const [row]=await manager.query<{id:string;status:string;version:string;updated_at:Date|string;changed:boolean}[]>('SELECT * FROM public.kleva_lead_change_status($1,$2,$3)',[leadId,status,expectedVersion]);if(!row)throw new NotFoundException();return {leadId:row.id,status:row.status,version:Number(row.version),updatedAt:row.updated_at,changed:row.changed};}
      catch(error){if((error as {code?:string}).code==='40001')throw new ConflictException('Lead changed. Refresh and try again.');throw error;}
    });
  }
  private serialize(row:LeadRow){return {...row,version:Number(row.version)};}
}
