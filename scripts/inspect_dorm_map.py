"""Crop user map for local close inspection only; source file remains untouched."""
from pathlib import Path
from PIL import Image,ImageDraw
import json
P=Path(__file__).resolve().parents[1]
OUT=P/'diagnostics/dorm_review';OUT.mkdir(parents=True,exist_ok=True)
image=Image.open(P.parent/'bb9e69ad7ce16bfda1a854e938151961.jpg')
for name,bounds in {'lan':(850,3620,2140,4550),'zhu':(880,2880,2100,3650),'ju':(3520,2440,4450,3570),'mei':(3500,3640,4590,4600)}.items():
    image.crop(bounds).save(OUT/(name+'-map.png'))
registered=Image.open(P.parent/'￥%……&/campus_georef.tif')
for name,bounds in {'lan':(950,3650,2150,4700),'zhu':(950,2950,2150,3680),'ju':(3520,2520,4450,3570),'mei':(3550,3700,4590,4650)}.items():
    registered.crop(bounds).convert('RGB').save(OUT/(name+'-registered.png'))
    crop=registered.crop(bounds).convert('RGB');draw=ImageDraw.Draw(crop)
    districts={'lan':'兰园','zhu':'竹园','ju':'菊园','mei':'梅园'}
    for row in json.loads((P/'reference/buildings/dorm_shapes_v002/input.json').read_text(encoding='utf-8'))['rows']:
        if row['district']!=districts[name]:continue
        g=row['geometryLocal'];polys=[g['coordinates']] if g['type']=='Polygon' else g['coordinates']
        for poly in polys:
            for ring in poly:
                pixels=[((x+635986.7561034276-635954.8830563505)/.35858544812789306-bounds[0],(4341918.878195945-y-4339716.120350528)/.35858544812789306-bounds[1]) for x,y in ring]
                draw.line(pixels,fill='#008dff',width=2)
                draw.text(pixels[0],row['sourceLabel'].split()[-1],fill='red',stroke_width=1,stroke_fill='white')
    crop.save(OUT/(name+'-overlay.png'))
print({'userMap':image.size,'registeredMap':registered.size})
for name,bounds in {'mei1north':(3590,3730,3820,3860),'mei4south':(3840,4120,4060,4250),'ju2north':(3580,2970,3810,3090),'lan5north':(1330,4300,1550,4430),'lan2south':(1900,4150,2120,4260)}.items():
    registered.crop(bounds).convert('RGB').resize(((bounds[2]-bounds[0])*3,(bounds[3]-bounds[1])*3)).save(OUT/(name+'-detail.png'))
