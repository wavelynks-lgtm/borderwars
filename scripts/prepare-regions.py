"""Compact Natural Earth admin-1 GeoJSON for the globe (public domain).
Usage: python3 scripts/prepare-regions.py /path/to/ne_10m_admin_1_states_provinces.geojson
Source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_admin_1_states_provinces.geojson
"""
import json
import sys
from pathlib import Path

def ring(points):
    # Douglas–Peucker tolerance well below one 5792-wide equatorial map cell.
    keep = {0, len(points)-1}
    pending = [(0, len(points)-1)]
    while pending:
        a,b = pending.pop()
        x,y = points[a][:2]; dx=points[b][0]-x; dy=points[b][1]-y
        length = dx*dx+dy*dy
        best = .012**2; index = -1
        for i in range(a+1,b):
            px,py = points[i][:2]
            t = max(0,min(1,((px-x)*dx+(py-y)*dy)/length)) if length else 0
            d = (px-x-t*dx)**2+(py-y-t*dy)**2
            if d>best: best=d; index=i
        if index>=0:
            keep.add(index); pending.extend([(a,index),(index,b)])
    simplified = [points[i] for i in sorted(keep)]
    if len(simplified)<4: simplified=points
    return [[round(x,3),round(y,3)] for x,y,*_ in simplified]

source=json.loads(Path(sys.argv[1]).read_text())
features=[]
for f in source['features']:
    p=f['properties']; g=f['geometry']
    if not g or g['type'] not in ['Polygon','MultiPolygon']: continue
    polygons=[g['coordinates']] if g['type']=='Polygon' else g['coordinates']
    polygons=[[ring(r) for r in polygon] for polygon in polygons]
    features.append({'type':'Feature','properties':{'name':p.get('name_en') or p.get('name') or p['adm1_code'],'admin':p['admin']},'geometry':{'type':g['type'],'coordinates':polygons[0] if g['type']=='Polygon' else polygons}})
Path('public/data/admin1.json').write_text(json.dumps({'type':'FeatureCollection','features':features},separators=(',',':'),ensure_ascii=False))
print(f'{len(features)} subdivisions prepared')
