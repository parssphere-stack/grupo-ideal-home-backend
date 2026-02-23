require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/grupo-ideal-home';
const propertySchema = new mongoose.Schema({
  idealista_id: String, title: String, description: String, price: Number,
  type: String, operation: String, url: String,
  location: { address: String, city: String, district: String, neighborhood: String, province: String, latitude: Number, longitude: Number },
  features: { size_sqm: Number, bedrooms: Number, bathrooms: Number, floor: String, has_elevator: Boolean, is_exterior: Boolean },
  images: [String],
  contact: { name: String, type: String, phone: String },
  is_particular: Boolean, status: String, source: String, scraped_at: Date,
}, { timestamps: true });
const Property = mongoose.model('Property', propertySchema);
const AGENCY_KW = ['inmobiliaria','real estate','realty','properties','gestión','gestion','consulting','grupo','servicios','inversiones','remax','re/max','century','keller williams','tecnocasa','gilmar','redpiso','donpiso','fincas','agencia','agency','broker','s.l','slu','s.a','sociedad','empresa','promotora','promociones','constructora','asesor','partners','walter haus','engel','sotheby','coldwell','lucas fox','housfy','housell','obra nueva','home select','premium living','luxury living','savills','knight frank'];
function isAgency(name, desc) {
  const n = (name||'').toLowerCase();
  const d = (desc||'').toLowerCase();
  if (AGENCY_KW.some(k => n.includes(k))) return true;
  if (['le presentamos','les presentamos','nuestra agencia','nuestro equipo','contacte con nosotros'].some(p => d.includes(p))) return true;
  return false;
}
async function checkUrl(url) {
  try {
    const r = await axios.get(url, { timeout:10000, maxRedirects:5, headers:{'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)','Accept-Language':'es-ES'}, validateStatus:()=>true });
    if (r.status===200 && r.data.includes('property-description')) return 'active';
    if (r.status===200 && (r.data.includes('no-results') || r.data.includes('anuncio ya no'))) return 'expired';
    if (r.status===404 || r.status===410) return 'expired';
    if (r.status===301 || r.status===302) { const loc=r.headers.location||''; return loc.includes('/inmueble/')?'active':'expired'; }
    if (r.status===429||r.status===403||r.status===425) return 'blocked';
    return 'unknown';
  } catch(e) { return 'error'; }
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function main() {
  console.log('\n🧹 Cleanup: agencies + expired');
  await mongoose.connect(MONGODB_URI);
  const all = await Property.find({});
  console.log('📦 Total:', all.length);
  // Step 1: agencies
  console.log('\n🏢 Step 1: Removing agencies...');
  let agDel=0;
  for (const p of all) {
    if (isAgency(p.contact?.name, p.description)) {
      await Property.deleteOne({_id:p._id});
      console.log('  ❌', p.contact?.name, '—', (p.title||'').substring(0,40));
      agDel++;
    }
  }
  console.log('🗑️ Agencies removed:', agDel);
  // Step 2: expired URLs
  console.log('\n🔗 Step 2: Checking URLs...');
  const rem = await Property.find({});
  console.log('Checking', rem.length, 'URLs...');
  let exp=0, act=0, blk=0;
  for (let i=0; i<rem.length; i++) {
    const p = rem[i];
    if (!p.url) { await Property.deleteOne({_id:p._id}); exp++; continue; }
    const s = await checkUrl(p.url);
    if (s==='expired') { await Property.deleteOne({_id:p._id}); console.log('  ❌ Expired:', p.url); exp++; }
    else if (s==='active') act++;
    else if (s==='blocked') blk++;
    if ((i+1)%10===0) console.log('  ...', i+1, '/', rem.length);
    await sleep(1500);
  }
  const final = await Property.countDocuments({});
  console.log('\n═══════════════════════════════');
  console.log('🏢 Agencies removed:', agDel);
  console.log('❌ Expired removed:', exp);
  console.log('✅ Active:', act);
  console.log('🚫 Blocked (kept):', blk);
  console.log('📦 Final count:', final);
  console.log('═══════════════════════════════');
  await mongoose.disconnect();
  console.log('Done!');
}
main().catch(e=>{console.error(e);process.exit(1)});
