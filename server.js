require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});

const JWT_SECRET = process.env.JWT_SECRET || 'altere-esta-chave-em-producao';
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false });
app.use('/api/login', authLimiter);

const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

function signUser(user) {
  return jwt.sign({ id: user.id, name: user.name, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
}
function setAuthCookie(res, token) {
  res.cookie('aurea_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000
  });
}
function auth(req,res,next){
  const token = req.cookies.aurea_token;
  if(!token) return res.status(401).json({ error:'Não autenticado' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error:'Sessão expirada' }); }
}
function roles(...allowed){
  return (req,res,next) => allowed.includes(req.user.role) ? next() : res.status(403).json({ error:'Sem permissão' });
}
function n(v){ return Number(v || 0); }
function positiveInt(v){ const x=Number(v); return Number.isInteger(x) && x>0 ? x : null; }

async function ensureAdmin(){
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  if(rows[0].c > 0) return;
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if(!username || !password) {
    console.warn('Banco sem usuários. Defina ADMIN_USERNAME e ADMIN_PASSWORD.');
    return;
  }
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    'INSERT INTO users(name,username,password_hash,role) VALUES($1,$2,$3,$4)',
    [process.env.ADMIN_NAME || 'Administrador', username.toLowerCase(), hash, 'administrador']
  );
  console.log('Administrador inicial criado.');
}

app.post('/api/login', asyncRoute(async(req,res)=>{
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const { rows } = await pool.query('SELECT * FROM users WHERE username=$1 AND active=TRUE', [username]);
  const user = rows[0];
  if(!user || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({ error:'Usuário ou senha inválidos' });
  setAuthCookie(res, signUser(user));
  res.json({ id:user.id, name:user.name, username:user.username, role:user.role });
}));
app.post('/api/logout', (req,res)=>{ res.clearCookie('aurea_token'); res.json({ok:true}); });
app.get('/api/me', auth, (req,res)=>res.json(req.user));

app.get('/api/dashboard', auth, asyncRoute(async(req,res)=>{
  const [sales, products, pieces, low, customers, profit, cash] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(total),0)::numeric AS total, COALESCE(SUM(CASE WHEN created_at::date=CURRENT_DATE THEN total ELSE 0 END),0)::numeric AS today FROM sales"),
    pool.query("SELECT COUNT(*)::int AS c FROM products WHERE active=TRUE"),
    pool.query("SELECT COALESCE(SUM(stock),0)::int AS c FROM product_variants"),
    pool.query("SELECT p.name,v.size,v.color,v.stock,p.min_stock FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.stock<=p.min_stock ORDER BY v.stock ASC,p.name LIMIT 30"),
    pool.query("SELECT COUNT(*)::int AS c FROM customers"),
    pool.query("SELECT COALESCE(SUM((si.unit_price-si.unit_cost)*si.quantity),0)::numeric AS gross FROM sale_items si"),
    pool.query("SELECT COALESCE(SUM(CASE WHEN type='entrada' THEN amount ELSE -amount END),0)::numeric AS balance FROM cash_transactions")
  ]);
  res.json({
    todaySales:n(sales.rows[0].today), revenue:n(sales.rows[0].total),
    products:products.rows[0].c, pieces:pieces.rows[0].c,
    customers:customers.rows[0].c, grossProfit:n(profit.rows[0].gross),
    cashBalance:n(cash.rows[0].balance), lowStock:low.rows
  });
}));

app.get('/api/products', auth, asyncRoute(async(req,res)=>{
  const { rows } = await pool.query(`
    SELECT p.*,
      COALESCE(json_agg(json_build_object('id',v.id,'size',v.size,'color',v.color,'stock',v.stock)
      ORDER BY v.size,v.color) FILTER (WHERE v.id IS NOT NULL),'[]') AS variants
    FROM products p
    LEFT JOIN product_variants v ON v.product_id=p.id
    WHERE p.active=TRUE
    GROUP BY p.id
    ORDER BY p.name
  `);
  res.json(rows);
}));
app.post('/api/products', auth, roles('administrador','vendedor'), asyncRoute(async(req,res)=>{
  const { name,type,category,sku,cost,price,minStock,variants } = req.body;
  if(!name || !['roupa','chinela'].includes(type) || n(price)<0 || !Array.isArray(variants)) return res.status(400).json({error:'Dados inválidos'});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pr = await client.query(
      'INSERT INTO products(name,type,category,sku,cost,price,min_stock) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [String(name).trim(),type,category||null,sku||null,n(cost),n(price),Math.max(0,Number(minStock||0))]
    );
    for(const v of variants){
      const qty=Math.max(0,Number(v.stock||0));
      const vr=await client.query(
        'INSERT INTO product_variants(product_id,size,color,stock) VALUES($1,$2,$3,$4) RETURNING id',
        [pr.rows[0].id,String(v.size),String(v.color||''),qty]
      );
      if(qty>0) await client.query(
        "INSERT INTO stock_movements(variant_id,user_id,movement_type,quantity,reason) VALUES($1,$2,'entrada',$3,'Estoque inicial')",
        [vr.rows[0].id,req.user.id,qty]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(pr.rows[0]);
  } catch(e){ await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));
app.delete('/api/products/:id', auth, roles('administrador'), asyncRoute(async(req,res)=>{
  await pool.query('UPDATE products SET active=FALSE,updated_at=NOW() WHERE id=$1',[req.params.id]);
  res.json({ok:true});
}));

app.get('/api/stock-movements', auth, asyncRoute(async(req,res)=>{
  const { rows }=await pool.query(`
    SELECT sm.id,sm.created_at,sm.movement_type,sm.quantity,sm.reason,p.name AS product,v.size,v.color,u.name AS user_name
    FROM stock_movements sm
    JOIN product_variants v ON v.id=sm.variant_id
    JOIN products p ON p.id=v.product_id
    LEFT JOIN users u ON u.id=sm.user_id
    ORDER BY sm.created_at DESC LIMIT 300`);
  res.json(rows);
}));
app.post('/api/stock-movements', auth, roles('administrador','vendedor'), asyncRoute(async(req,res)=>{
  const variantId=positiveInt(req.body.variantId), qty=positiveInt(req.body.quantity), type=req.body.type;
  if(!variantId||!qty||!['entrada','saida','ajuste'].includes(type)) return res.status(400).json({error:'Dados inválidos'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const vr=await client.query('SELECT stock FROM product_variants WHERE id=$1 FOR UPDATE',[variantId]);
    if(!vr.rows[0]) throw Object.assign(new Error('Variação não encontrada'),{status:404});
    let newStock=n(vr.rows[0].stock);
    if(type==='entrada') newStock+=qty; else newStock-=qty;
    if(newStock<0) throw Object.assign(new Error('Estoque insuficiente'),{status:400});
    await client.query('UPDATE product_variants SET stock=$1,updated_at=NOW() WHERE id=$2',[newStock,variantId]);
    await client.query('INSERT INTO stock_movements(variant_id,user_id,movement_type,quantity,reason) VALUES($1,$2,$3,$4,$5)',[variantId,req.user.id,type,qty,req.body.reason||null]);
    await client.query('COMMIT'); res.json({ok:true,stock:newStock});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));

app.get('/api/customers', auth, asyncRoute(async(req,res)=>{
  const { rows }=await pool.query('SELECT * FROM customers ORDER BY name'); res.json(rows);
}));
app.post('/api/customers', auth, asyncRoute(async(req,res)=>{
  if(!req.body.name) return res.status(400).json({error:'Nome obrigatório'});
  const {rows}=await pool.query('INSERT INTO customers(name,phone,cpf) VALUES($1,$2,$3) RETURNING *',[req.body.name,req.body.phone||null,req.body.cpf||null]); res.status(201).json(rows[0]);
}));
app.delete('/api/customers/:id', auth, roles('administrador','vendedor'), asyncRoute(async(req,res)=>{
  await pool.query('DELETE FROM customers WHERE id=$1',[req.params.id]); res.json({ok:true});
}));

app.get('/api/suppliers', auth, asyncRoute(async(req,res)=>{
  const { rows }=await pool.query('SELECT * FROM suppliers ORDER BY name'); res.json(rows);
}));
app.post('/api/suppliers', auth, roles('administrador','vendedor'), asyncRoute(async(req,res)=>{
  if(!req.body.name) return res.status(400).json({error:'Nome obrigatório'});
  const {rows}=await pool.query('INSERT INTO suppliers(name,phone,document) VALUES($1,$2,$3) RETURNING *',[req.body.name,req.body.phone||null,req.body.document||null]); res.status(201).json(rows[0]);
}));
app.delete('/api/suppliers/:id', auth, roles('administrador'), asyncRoute(async(req,res)=>{
  await pool.query('DELETE FROM suppliers WHERE id=$1',[req.params.id]); res.json({ok:true});
}));

app.get('/api/sales', auth, asyncRoute(async(req,res)=>{
  const {rows}=await pool.query(`
    SELECT s.*,c.name AS customer_name,u.name AS user_name,
      COALESCE(json_agg(json_build_object('product',p.name,'size',v.size,'color',v.color,'quantity',si.quantity,'unit_price',si.unit_price)
      ORDER BY si.id) FILTER(WHERE si.id IS NOT NULL),'[]') AS items
    FROM sales s
    LEFT JOIN customers c ON c.id=s.customer_id
    LEFT JOIN users u ON u.id=s.user_id
    LEFT JOIN sale_items si ON si.sale_id=s.id
    LEFT JOIN product_variants v ON v.id=si.variant_id
    LEFT JOIN products p ON p.id=v.product_id
    GROUP BY s.id,c.name,u.name ORDER BY s.created_at DESC LIMIT 300`);
  res.json(rows);
}));
app.post('/api/sales', auth, asyncRoute(async(req,res)=>{
  const items=Array.isArray(req.body.items)?req.body.items:[];
  if(!items.length) return res.status(400).json({error:'Venda sem itens'});
  const discount=Math.max(0,n(req.body.discount));
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    let subtotal=0; const locked=[];
    for(const item of items){
      const qty=positiveInt(item.quantity), variantId=positiveInt(item.variantId);
      if(!qty||!variantId) throw Object.assign(new Error('Item inválido'),{status:400});
      const vr=await client.query(`
        SELECT v.id,v.stock,p.price,p.cost,p.name,p.type,v.size,v.color
        FROM product_variants v JOIN products p ON p.id=v.product_id
        WHERE v.id=$1 AND p.active=TRUE FOR UPDATE`,[variantId]);
      if(!vr.rows[0]) throw Object.assign(new Error('Produto não encontrado'),{status:404});
      if(vr.rows[0].stock<qty) throw Object.assign(new Error('Estoque insuficiente para '+vr.rows[0].name+' '+vr.rows[0].size),{status:400});
      subtotal += n(vr.rows[0].price)*qty;
      locked.push({ ...vr.rows[0], qty });
    }
    const total=Math.max(0,subtotal-discount);
    const sr=await client.query(
      'INSERT INTO sales(customer_id,user_id,payment_method,subtotal,discount,total) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.body.customerId||null,req.user.id,req.body.paymentMethod||'PIX',subtotal,discount,total]
    );
    for(const it of locked){
      await client.query('INSERT INTO sale_items(sale_id,variant_id,quantity,unit_price,unit_cost) VALUES($1,$2,$3,$4,$5)',[sr.rows[0].id,it.id,it.qty,it.price,it.cost]);
      await client.query('UPDATE product_variants SET stock=stock-$1,updated_at=NOW() WHERE id=$2',[it.qty,it.id]);
      await client.query("INSERT INTO stock_movements(variant_id,user_id,movement_type,quantity,reason,reference_type,reference_id) VALUES($1,$2,'venda',$3,$4,'sale',$5)",[it.id,req.user.id,it.qty,'Venda #'+sr.rows[0].id,sr.rows[0].id]);
    }
    await client.query("INSERT INTO cash_transactions(user_id,type,category,description,amount,sale_id) VALUES($1,'entrada','vendas',$2,$3,$4)",[req.user.id,'Venda #'+sr.rows[0].id,total,sr.rows[0].id]);

    const chinelaQty=locked.filter(it=>it.type==='chinela').reduce((sum,it)=>sum+it.qty,0);
    if(chinelaQty>0){
      const merchandiseCost=Number((chinelaQty*33.33).toFixed(2));
      const packagingCost=Number((chinelaQty*1.52).toFixed(2));
      await client.query(
        "INSERT INTO cash_transactions(user_id,type,category,description,amount,sale_id) VALUES($1,'saida','mercadoria',$2,$3,$4)",
        [req.user.id,'Custo automático de chinelas + frete - Venda #'+sr.rows[0].id+' ('+chinelaQty+' par(es))',merchandiseCost,sr.rows[0].id]
      );
      await client.query(
        "INSERT INTO cash_transactions(user_id,type,category,description,amount,sale_id) VALUES($1,'saida','despesas',$2,$3,$4)",
        [req.user.id,'Custo automático de embalagens - Venda #'+sr.rows[0].id+' ('+chinelaQty+' par(es))',packagingCost,sr.rows[0].id]
      );
    }

    await client.query('COMMIT'); res.status(201).json(sr.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));

app.delete('/api/sales/:id', auth, roles('administrador'), asyncRoute(async(req,res)=>{
  const saleId=positiveInt(req.params.id);
  if(!saleId) return res.status(400).json({error:'Venda inválida'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const sale=await client.query('SELECT id FROM sales WHERE id=$1 FOR UPDATE',[saleId]);
    if(!sale.rows[0]) throw Object.assign(new Error('Venda não encontrada'),{status:404});
    const items=await client.query('SELECT variant_id,quantity FROM sale_items WHERE sale_id=$1',[saleId]);
    for(const it of items.rows){
      await client.query('UPDATE product_variants SET stock=stock+$1,updated_at=NOW() WHERE id=$2',[it.quantity,it.variant_id]);
    }
    await client.query("DELETE FROM stock_movements WHERE reference_type='sale' AND reference_id=$1",[saleId]);
    await client.query('DELETE FROM cash_transactions WHERE sale_id=$1',[saleId]);
    await client.query('DELETE FROM sale_items WHERE sale_id=$1',[saleId]);
    await client.query('DELETE FROM sales WHERE id=$1',[saleId]);
    await client.query('COMMIT');
    res.json({ok:true});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));

app.get('/api/purchases', auth, asyncRoute(async(req,res)=>{
  const {rows}=await pool.query(`
    SELECT pu.*,s.name AS supplier_name,u.name AS user_name,
      COALESCE(json_agg(json_build_object('product',p.name,'size',v.size,'color',v.color,'quantity',pi.quantity,'unit_cost',pi.unit_cost)
      ORDER BY pi.id) FILTER(WHERE pi.id IS NOT NULL),'[]') AS items
    FROM purchases pu
    LEFT JOIN suppliers s ON s.id=pu.supplier_id
    LEFT JOIN users u ON u.id=pu.user_id
    LEFT JOIN purchase_items pi ON pi.purchase_id=pu.id
    LEFT JOIN product_variants v ON v.id=pi.variant_id
    LEFT JOIN products p ON p.id=v.product_id
    GROUP BY pu.id,s.name,u.name ORDER BY pu.created_at DESC LIMIT 300`);
  res.json(rows);
}));
app.post('/api/purchases', auth, roles('administrador','vendedor'), asyncRoute(async(req,res)=>{
  const items=Array.isArray(req.body.items)?req.body.items:[];
  if(!items.length) return res.status(400).json({error:'Compra sem itens'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    let total=0; const checked=[];
    for(const item of items){
      const qty=positiveInt(item.quantity), variantId=positiveInt(item.variantId), cost=n(item.unitCost);
      if(!qty||!variantId||cost<0) throw Object.assign(new Error('Item de compra inválido'),{status:400});
      const vr=await client.query('SELECT v.id,p.id AS product_id FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=$1 FOR UPDATE',[variantId]);
      if(!vr.rows[0]) throw Object.assign(new Error('Variação não encontrada'),{status:404});
      total+=qty*cost; checked.push({variantId,qty,cost,productId:vr.rows[0].product_id});
    }
    const pr=await client.query('INSERT INTO purchases(supplier_id,user_id,total) VALUES($1,$2,$3) RETURNING *',[req.body.supplierId||null,req.user.id,total]);
    for(const it of checked){
      await client.query('INSERT INTO purchase_items(purchase_id,variant_id,quantity,unit_cost) VALUES($1,$2,$3,$4)',[pr.rows[0].id,it.variantId,it.qty,it.cost]);
      await client.query('UPDATE product_variants SET stock=stock+$1,updated_at=NOW() WHERE id=$2',[it.qty,it.variantId]);
      await client.query('UPDATE products SET cost=$1,updated_at=NOW() WHERE id=$2',[it.cost,it.productId]);
      await client.query("INSERT INTO stock_movements(variant_id,user_id,movement_type,quantity,reason,reference_type,reference_id) VALUES($1,$2,'compra',$3,$4,'purchase',$5)",[it.variantId,req.user.id,it.qty,'Compra #'+pr.rows[0].id,pr.rows[0].id]);
    }
    await client.query("INSERT INTO cash_transactions(user_id,type,category,description,amount,purchase_id) VALUES($1,'saida','mercadoria',$2,$3,$4)",[req.user.id,'Compra de mercadoria #'+pr.rows[0].id,total,pr.rows[0].id]);
    await client.query('COMMIT'); res.status(201).json(pr.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));

app.get('/api/cash', auth, asyncRoute(async(req,res)=>{
  const [settings,tx,salesTotal]=await Promise.all([
    pool.query('SELECT * FROM cash_allocation_settings WHERE id=1'),
    pool.query('SELECT * FROM cash_transactions ORDER BY created_at DESC LIMIT 500'),
    pool.query('SELECT COALESCE(SUM(total),0)::numeric AS total FROM sales')
  ]);
  const st=settings.rows[0], revenue=n(salesTotal.rows[0].total);
  const cats={emergencias:'emergencies_pct',despesas:'miscellaneous_pct',mercadoria:'merchandise_pct',prolabore:'pro_labore_pct'};
  const boxes={};
  for(const [cat,col] of Object.entries(cats)){
    const reserved=revenue*n(st[col])/100;
    const manualIn=tx.rows.filter(x=>x.category===cat&&x.type==='entrada').reduce((s,x)=>s+n(x.amount),0);
    const out=tx.rows.filter(x=>x.category===cat&&x.type==='saida').reduce((s,x)=>s+n(x.amount),0);
    boxes[cat]={reserved,manualIn,out,available:reserved+manualIn-out};
  }
  const entries=tx.rows.filter(x=>x.type==='entrada').reduce((s,x)=>s+n(x.amount),0);
  const exits=tx.rows.filter(x=>x.type==='saida').reduce((s,x)=>s+n(x.amount),0);
  res.json({settings:st,transactions:tx.rows,entries,exits,balance:entries-exits,boxes});
}));
app.put('/api/cash/settings', auth, roles('administrador'), asyncRoute(async(req,res)=>{
  const e=n(req.body.emergencies),d=n(req.body.miscellaneous),m=n(req.body.merchandise),p=n(req.body.proLabore);
  if(Math.abs(e+d+m+p-100)>0.001) return res.status(400).json({error:'Os percentuais devem somar 100%'});
  const {rows}=await pool.query('UPDATE cash_allocation_settings SET emergencies_pct=$1,miscellaneous_pct=$2,merchandise_pct=$3,pro_labore_pct=$4,updated_at=NOW() WHERE id=1 RETURNING *',[e,d,m,p]);
  res.json(rows[0]);
}));
app.post('/api/cash/transactions', auth, roles('administrador','caixa'), asyncRoute(async(req,res)=>{
  const {type,category,description}=req.body, amount=n(req.body.amount);
  if(!['entrada','saida'].includes(type)||!['emergencias','despesas','mercadoria','prolabore'].includes(category)||!description||amount<=0) return res.status(400).json({error:'Dados inválidos'});
  const {rows}=await pool.query('INSERT INTO cash_transactions(user_id,type,category,description,amount) VALUES($1,$2,$3,$4,$5) RETURNING *',[req.user.id,type,category,description,amount]); res.status(201).json(rows[0]);
}));
app.delete('/api/cash/transactions/:id', auth, roles('administrador','caixa'), asyncRoute(async(req,res)=>{
  const id=positiveInt(req.params.id);
  if(!id) return res.status(400).json({error:'Lançamento inválido'});
  const {rows}=await pool.query('SELECT id,sale_id,purchase_id FROM cash_transactions WHERE id=$1',[id]);
  const tx=rows[0];
  if(!tx) return res.status(404).json({error:'Lançamento não encontrado'});
  if(tx.sale_id) return res.status(400).json({error:'Este lançamento pertence a uma venda. Exclua a venda para corrigir estoque e caixa juntos.'});
  if(tx.purchase_id) return res.status(400).json({error:'Este lançamento pertence a uma compra e não pode ser excluído isoladamente.'});
  await pool.query('DELETE FROM cash_transactions WHERE id=$1',[id]);
  res.json({ok:true});
}));

app.get('/api/users', auth, roles('administrador'), asyncRoute(async(req,res)=>{
  const {rows}=await pool.query('SELECT id,name,username,role,active,created_at FROM users ORDER BY name'); res.json(rows);
}));
app.post('/api/users', auth, roles('administrador'), asyncRoute(async(req,res)=>{
  const name=String(req.body.name||'').trim(), username=String(req.body.username||'').trim().toLowerCase(), password=String(req.body.password||''), role=req.body.role;
  if(!name||!username||password.length<6||!['administrador','vendedor','caixa'].includes(role)) return res.status(400).json({error:'Dados inválidos; senha mínima de 6 caracteres'});
  const hash=await bcrypt.hash(password,12);
  const {rows}=await pool.query('INSERT INTO users(name,username,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,username,role,active',[name,username,hash,role]);
  res.status(201).json(rows[0]);
}));
app.patch('/api/users/:id/status', auth, roles('administrador'), asyncRoute(async(req,res)=>{
  if(Number(req.params.id)===Number(req.user.id)) return res.status(400).json({error:'Não é possível desativar o próprio usuário'});
  const {rows}=await pool.query('UPDATE users SET active=$1,updated_at=NOW() WHERE id=$2 RETURNING id,name,username,role,active',[!!req.body.active,req.params.id]);
  res.json(rows[0]);
}));
app.delete('/api/users/:id', auth, roles('administrador'), asyncRoute(async(req,res)=>{
  if(Number(req.params.id)===Number(req.user.id)) return res.status(400).json({error:'Não é possível excluir o próprio usuário'});
  await pool.query('DELETE FROM users WHERE id=$1',[req.params.id]); res.json({ok:true});
}));

app.get('/api/reports', auth, asyncRoute(async(req,res)=>{
  const [summary,products,sizes]=await Promise.all([
    pool.query("SELECT (SELECT COALESCE(SUM(total),0) FROM sales)::numeric revenue, COALESCE(SUM(si.unit_cost*si.quantity),0)::numeric cmv, COALESCE(SUM((si.unit_price-si.unit_cost)*si.quantity),0)::numeric gross FROM sale_items si"),
    pool.query("SELECT p.name,SUM(si.quantity)::int quantity FROM sale_items si JOIN product_variants v ON v.id=si.variant_id JOIN products p ON p.id=v.product_id GROUP BY p.name ORDER BY quantity DESC LIMIT 20"),
    pool.query("SELECT v.size,SUM(si.quantity)::int quantity FROM sale_items si JOIN product_variants v ON v.id=si.variant_id GROUP BY v.size ORDER BY quantity DESC LIMIT 20")
  ]);
  const revenue=n(summary.rows[0].revenue);
  const count=(await pool.query('SELECT COUNT(*)::int c FROM sales')).rows[0].c;
  res.json({revenue,cmv:n(summary.rows[0].cmv),gross:n(summary.rows[0].gross),ticket:count?revenue/count:0,products:products.rows,sizes:sizes.rows});
}));

app.get('/health', (req,res)=>res.json({ok:true}));

app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.use((err,req,res,next)=>{
  console.error(err);
  if(err.code==='23505') return res.status(409).json({error:'Registro duplicado'});
  res.status(err.status||500).json({error:err.message||'Erro interno'});
});

const port=process.env.PORT||3000;
(async()=>{
  await pool.query('SELECT 1');
  await ensureAdmin();
  app.listen(port,()=>console.log('AUREA+ online na porta '+port));
})().catch(err=>{ console.error('Falha ao iniciar:',err); process.exit(1); });
