import {parentPort,workerData} from 'node:worker_threads';
import {gzipSync} from 'node:zlib';
import {generateWorld} from '../src/map/generator.ts';
const map=generateWorld(workerData);
const meta=Buffer.from(JSON.stringify({width:map.width,height:map.height,countries:map.countries,generated:map.generated}));
const header=Buffer.alloc(4);header.writeUInt32LE(meta.length);
parentPort.postMessage(gzipSync(Buffer.concat([header,meta,Buffer.from(map.terrain),Buffer.from(map.country.buffer),Buffer.from(map.elevation)])));
