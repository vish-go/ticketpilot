import pg from 'pg';
export interface Database {query(sql:string,params?:any[]):Promise<{rows:any[];rowCount:number|null}>;transaction<T>(fn:(db:Database)=>Promise<T>):Promise<T>;close():Promise<void>}
export function postgres(url:string):Database {
 const pool=new pg.Pool({connectionString:url,max:10,ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:true}:undefined});
 const wrap=(client:pg.Pool|pg.PoolClient):Database=>({query:async(sql,params)=>client.query(sql,params),transaction:async(fn)=>{const c=await pool.connect();try{await c.query('BEGIN');const value=await fn(wrap(c));await c.query('COMMIT');return value;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}},close:()=>pool.end()});
 return wrap(pool);
}
export const db:Database=postgres(process.env.DATABASE_URL||'postgres://ticketpilot:ticketpilot@localhost:5432/ticketpilot');
