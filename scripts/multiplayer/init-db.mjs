import {Store} from '../../server/store.mjs';
import {Commerce} from '../../server/commerce.mjs';

const url=process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL;
if(!url)throw new Error('Set DATABASE_URL before initializing the online database');
const store=new Store(url);
try {
  await store.init();
  await new Commerce(store,{}).init();
  await store.leaderboard();
  console.log('Online database connected; accounts, sessions, matches, results, purchases and cosmetics are ready.');
} finally {await store.close();}
