import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
    throw error;
  }
}
export async function load(url, context, next) {
  if (!url.endsWith('.ts')) return next(url, context);
  const source = await readFile(new URL(url), 'utf8');
  return { format: 'module', shortCircuit: true, source: stripTypeScriptTypes(source, { mode: 'transform', sourceUrl: url }) };
}
