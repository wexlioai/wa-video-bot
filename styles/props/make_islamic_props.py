import math, json, os
OUT='/home/claude/repo-wvb/styles/props/islamic'
props={}
def add(name, desc, vb, body, params=None, parts=None):
    svg=f'<svg class="prop prop-{name}" viewBox="{vb}" xmlns="http://www.w3.org/2000/svg">{body}</svg>'
    open(f'{OUT}/{name}.svg','w').write(svg)
    props[name]={'file':f'{name}.svg','description':desc,'viewBox':vb,'params':params or {},'parts':parts or []}
def P(points): return ' '.join(f'{x:.1f},{y:.1f}' for x,y in points)

# ---------- map (lon 30..60, lat 11..34) -> 1000 x 766
def proj(lon,lat): return ((lon-30)/30*1000, (34-lat)/23*766)
def poly(pts): return 'M'+' L'.join(f'{proj(*p)[0]:.1f},{proj(*p)[1]:.1f}' for p in pts)+' Z'
arabia=[(34,34),(48,34),(48.2,31.5),(47.9,30.0),(48.5,28.5),(49.5,27.2),(50.2,26.2),(50.8,24.8),(51.5,25.6),(52,24.1),(55,24.5),(56.3,26.2),(57,24),(58.5,23.6),(59.8,22.5),(58.5,20.5),(57,18.8),(55,17.7),(52.2,16.5),(50,15),(48,14),(45,12.8),(43.3,12.7),(42.8,14.8),(42.55,16.9),(41.5,18.2),(40.27,20.15),(39.17,21.5),(38.9,22.6),(38.06,24.09),(37.27,25.0),(36.45,26.2),(35.69,27.35),(34.96,29.29),(34.6,29.4),(34.2,31.2)]
africa=[(30,34),(32.3,31.3),(32.5,29.9),(33.6,27.6),(35,24),(37.2,19),(38.5,17),(39.5,15.5),(41,14),(43.2,12.3),(43.5,11),(30,11)]
sinai=[(32.5,29.9),(34.6,29.4),(34.2,31.2),(32.3,31.3)]
iran=[(48.5,34),(48.5,30.2),(50.5,29.2),(51.5,27.8),(54,26.6),(56.3,27.1),(57.5,25.7),(60,25.3),(60,34)]
cities={'mecca':(39.83,21.42,'Mecca'),'medina':(39.61,24.47,'Medina'),'taif':(40.42,21.27,"Ta'if"),'badr':(38.79,23.78,'Badr'),'khaybar':(39.29,25.70,'Khaybar'),'hudaybiyyah':(39.55,21.6,'Hudaybiyyah'),'jerusalem':(35.21,31.77,'Jerusalem'),'damascus':(36.29,33.51,'Damascus'),'kufa':(44.40,32.03,'Kufa'),'basra':(47.8,30.5,'Basra'),'baghdad':(44.4,33.3,'Baghdad'),'sanaa':(44.19,15.37,"Sana'a"),'tabuk':(36.57,28.38,'Tabuk')}
c=[]
for k,(lon,lat,lab) in cities.items():
    x,y=proj(lon,lat)
    dx = -14 if k in ('hudaybiyyah','badr','jerusalem','damascus') else 14
    dy = 6
    if k == 'mecca': dx, dy = -14, 28
    if k == 'taif': dx, dy = 14, 14
    if k == 'hudaybiyyah': dx, dy = -14, -8
    anchor = 'end' if dx<0 else 'start'
    c.append(f'<g class="city city-{k}"><circle class="city-ring" cx="{x:.1f}" cy="{y:.1f}" r="16" fill="none" stroke="var(--accent)" stroke-width="3" opacity=".0"/><circle class="city-dot" cx="{x:.1f}" cy="{y:.1f}" r="7" fill="var(--text)"/><text class="city-label label-{k}" x="{x+dx:.1f}" y="{y+dy:.1f}" text-anchor="{anchor}" font-family="Inter, sans-serif" font-weight="600" font-size="20" fill="var(--text)">{lab}</text></g>')
hatch=''.join(f'<line x1="{i}" y1="0" x2="{i-300}" y2="766" />' for i in range(0,1400,26))
body=f'''<defs><clipPath id="landclip"><path d="{poly(arabia)} {poly(africa)} {poly(iran)} {poly(sinai)}"/></clipPath></defs>
<rect class="sea" width="1000" height="766" fill="var(--bg2)"/>
<g class="land"><path d="{poly(arabia)}" fill="var(--bg)" stroke="var(--text)" stroke-opacity=".35" stroke-width="2"/><path d="{poly(africa)}" fill="var(--bg)" opacity=".75" stroke="var(--text)" stroke-opacity=".25" stroke-width="2"/><path d="{poly(sinai)}" fill="var(--bg)" opacity=".75"/><path d="{poly(iran)}" fill="var(--bg)" opacity=".75" stroke="var(--text)" stroke-opacity=".25" stroke-width="2"/></g>
<g class="relief" clip-path="url(#landclip)" stroke="var(--text)" stroke-opacity=".05" stroke-width="2">{hatch}</g>
<g class="region-hijaz"><path d="{poly([(35.9,28.2),(37.6,27.3),(40.4,25.0),(41.3,21.6),(41.0,19.9),(40.4,20.0),(39.3,21.4),(38.9,22.7),(38.1,24.2),(37.3,25.1),(36.5,26.3),(35.75,27.4)])}" fill="var(--primary)" opacity=".12" stroke="var(--primary)" stroke-dasharray="8 8" stroke-width="2"/><text class="label-hijaz" x="{proj(38.3,26.2)[0]:.1f}" y="{proj(38.3,26.2)[1]:.1f}" font-family="Inter, sans-serif" font-weight="700" font-size="18" letter-spacing="6" fill="var(--primary)" opacity=".8" transform="rotate(-50 {proj(38.3,26.2)[0]:.1f} {proj(38.3,26.2)[1]:.1f})">HIJAZ</text></g>
<g class="sea-labels" font-family="Lora, serif" font-style="italic" font-size="20" fill="var(--text)" opacity=".45"><text x="{proj(37.4,19.6)[0]:.0f}" y="{proj(37.4,19.6)[1]:.0f}" transform="rotate(-58 {proj(37.4,19.6)[0]:.0f} {proj(37.4,19.6)[1]:.0f})">Red Sea</text><text x="{proj(51.6,27.3)[0]:.0f}" y="{proj(51.6,27.3)[1]:.0f}" transform="rotate(-35 {proj(51.6,27.3)[0]:.0f} {proj(51.6,27.3)[1]:.0f})">Gulf</text></g>
<g class="cities">{''.join(c)}</g>'''
add('arabia-map','Schematic map of the Arabian Peninsula and neighbours (Red Sea, Gulf, Hijaz region) with cities: mecca, medina, taif, badr, khaybar, hudaybiyyah, tabuk, jerusalem, damascus, kufa, basra, baghdad, sanaa. Coordinates are real (equirectangular). To zoom on a city, scale/translate the prop; to show a route, draw your own path between city positions (see cityPositions).', '0 0 1000 766', body,
    parts=['.sea','.land','.relief','.region-hijaz','.city','.city-<id> (e.g. .city-medina)','.city-dot','.city-ring (opacity 0: animate to pulse once)','.city-label'])
props['arabia-map']['cityPositions']={k:[round(proj(lo,la)[0]),round(proj(lo,la)[1])] for k,(lo,la,_) in cities.items()}

# ---------- 8-point star helpers
def star8(cx,cy,R,r):
    pts=[]
    for i in range(16):
        a=math.pi/8*i - math.pi/2
        rr = R if i%2==0 else r
        pts.append((cx+rr*math.cos(a), cy+rr*math.sin(a)))
    return pts
s=star8(100,100,92,70)
body=f'''<polygon class="star-outer" points="{P(s)}" fill="var(--accent)" opacity=".18" stroke="var(--accent)" stroke-width="3"/>
<rect class="star-sq1" x="40" y="40" width="120" height="120" fill="none" stroke="var(--accent)" stroke-width="3"/><rect class="star-sq2" x="40" y="40" width="120" height="120" fill="none" stroke="var(--accent)" stroke-width="3" transform="rotate(45 100 100)"/>
<circle class="star-core" cx="100" cy="100" r="30" fill="var(--primary)" stroke="var(--accent)" stroke-width="3"/>
<text class="star-text" x="100" y="110" text-anchor="middle" font-family="Lora, serif" font-weight="700" font-size="30" fill="var(--bg)">{{{{text}}}}</text>'''
add('star-rosette','An 8-point star rosette (two rotated squares in a star) with a core circle and an optional short text (number/term). For medallions, section markers, bullets.', '0 0 200 200', body, params={'text':''}, parts=['.star-outer','.star-sq1','.star-sq2','.star-core','.star-text'])

# girih band (pattern), width 1200 x 120 tile 120
tile=star8(60,60,52,40)
body=f'''<defs><pattern id="gb-{{{{id}}}}" width="120" height="120" patternUnits="userSpaceOnUse"><g fill="none" stroke="var(--accent)" stroke-width="2.5"><polygon points="{P(tile)}"/><rect x="31" y="31" width="58" height="58" transform="rotate(45 60 60)"/><circle cx="60" cy="60" r="9"/><path d="M0 60 H8 M112 60 H120 M60 0 V8 M60 112 V120"/></g></pattern></defs>
<rect class="girih-fill" width="1200" height="120" fill="url(#gb-{{{{id}}}})"/><line class="girih-rule" x1="0" y1="2" x2="1200" y2="2" stroke="var(--accent)" stroke-width="3"/><line class="girih-rule" x1="0" y1="118" x2="1200" y2="118" stroke="var(--accent)" stroke-width="3"/>'''
add('girih-band','A horizontal band of 8-point star (girih) tiles between two gold rules. Stretch it (preserveAspectRatio is meet: set width; height follows 10:1). Give each instance a unique id param.', '0 0 1200 120', body, params={'id':'a'}, parts=['.girih-fill','.girih-rule'])

# full-frame girih pattern background
body=f'''<defs><pattern id="gp-{{{{id}}}}" width="160" height="160" patternUnits="userSpaceOnUse"><g fill="none" stroke="var(--accent)" stroke-width="2"><polygon points="{P(star8(80,80,70,53))}"/><rect x="41" y="41" width="78" height="78" transform="rotate(45 80 80)"/><rect x="41" y="41" width="78" height="78"/><circle cx="80" cy="80" r="14"/><path d="M0 0 L22 22 M160 0 L138 22 M0 160 L22 138 M160 160 L138 138"/></g></pattern></defs><rect class="pattern-fill" width="1920" height="1080" fill="url(#gp-{{{{id}}}})"/>'''
add('girih-pattern','Full-canvas girih (8-point star) pattern for backgrounds. Use at 15-40 % opacity. Unique id param per instance.', '0 0 1920 1080', body, params={'id':'a'}, parts=['.pattern-fill'])

# wax seal
blob=[]
for i in range(48):
    a=2*math.pi*i/48; r=96+ (5 if i%2 else -3)
    blob.append((110+r*math.cos(a),110+r*math.sin(a)))
body=f'''<defs><radialGradient id="sealg" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#C0453B"/><stop offset=".7" stop-color="#8E2620"/><stop offset="1" stop-color="#6E1A16"/></radialGradient></defs>
<polygon class="seal-body" points="{P(blob)}" fill="url(#sealg)"/>
<circle class="seal-ring" cx="110" cy="110" r="70" fill="none" stroke="#F3D9A6" stroke-opacity=".55" stroke-width="3"/>
<polygon class="seal-star" points="{P(star8(110,110,40,30))}" fill="none" stroke="#F3D9A6" stroke-opacity=".35" stroke-width="2"/>
<text class="seal-text" x="110" y="122" text-anchor="middle" font-family="Lora, serif" font-weight="700" font-size="34" fill="#F7E3B8">{{{{text}}}}</text>'''
add('wax-seal','A red wax seal with a cream ring, a faint star and a short text (e.g. "1 AH", "622"). Stamp it in: scale 1.4 -> 1 with a quick settle.', '0 0 220 220', body, params={'text':''}, parts=['.seal-body','.seal-ring','.seal-star','.seal-text'])

# held stamp
body=f'''<g class="stamp" fill="none" stroke="#A8322B" stroke-width="10" opacity=".92"><circle cx="130" cy="130" r="118"/><circle cx="130" cy="130" r="96" stroke-width="4"/></g>
<text class="stamp-text" x="130" y="150" text-anchor="middle" font-family="Inter, sans-serif" font-weight="800" font-size="58" letter-spacing="4" fill="#A8322B">{{{{text}}}}</text>
<text class="stamp-sub" x="130" y="190" text-anchor="middle" font-family="Inter, sans-serif" font-weight="700" font-size="16" letter-spacing="5" fill="#A8322B">{{{{sub}}}}</text>'''
add('stamp','A red circular rubber stamp, default text HELD. Stamp in: scale 1.6 -> 1, rotate -20 -> -12 deg, opacity 0 -> 1 in 0.25 s.', '0 0 260 260', body, params={'text':'HELD','sub':''}, parts=['.stamp','.stamp-text','.stamp-sub'])

# document
lines=''.join(f'<line x1="90" y1="{y}" x2="810" y2="{y}"/>' for y in range(560,1060,48))
body=f'''<rect class="doc-paper" x="10" y="10" width="880" height="1180" rx="6" fill="#F8F0DE" stroke="#000" stroke-opacity=".06"/>
<rect class="doc-border" x="40" y="40" width="820" height="1120" fill="none" stroke="var(--accent)" stroke-width="3"/><rect class="doc-border" x="52" y="52" width="796" height="1096" fill="none" stroke="var(--accent)" stroke-width="1.5"/>
<g class="doc-lines" stroke="#2A1D10" stroke-opacity=".14" stroke-width="2">{lines}</g>'''
add('document','A portrait judgment document: cream paper, gold double border, faint ruled lines in the lower half (put your HTML text above it, positioned over the prop). Give it a soft shadow with CSS filter: drop-shadow.', '0 0 900 1200', body, parts=['.doc-paper','.doc-border','.doc-lines line'])

# wide document (16:9 friendly)
lines2=''.join(f'<line x1="120" y1="{y}" x2="1280" y2="{y}"/>' for y in range(620,840,44))
body=f'''<rect class="doc-paper" x="10" y="10" width="1380" height="880" rx="6" fill="#F8F0DE" stroke="#000" stroke-opacity=".06"/>
<rect class="doc-border" x="40" y="40" width="1320" height="820" fill="none" stroke="var(--accent)" stroke-width="3"/><rect class="doc-border" x="52" y="52" width="1296" height="796" fill="none" stroke="var(--accent)" stroke-width="1.5"/>
<g class="doc-lines" stroke="#2A1D10" stroke-opacity=".14" stroke-width="2">{lines2}</g>'''
add('document-wide','A landscape judgment document (14:9) for 16:9 videos: cream paper, gold double border, a few faint ruled lines near the bottom. Place HTML text over it.', '0 0 1400 900', body, parts=['.doc-paper','.doc-border','.doc-lines line'])

# scroll
body='''<rect class="scroll-paper" x="60" y="40" width="680" height="420" fill="#F3E3C0"/>
<path class="scroll-shade" d="M60 40 h680 v30 h-680z" fill="#000" opacity=".05"/>
<g class="scroll-rod-left"><rect x="20" y="20" width="44" height="460" rx="22" fill="#8C6A2F"/><rect x="28" y="20" width="10" height="460" fill="#fff" opacity=".18"/></g>
<g class="scroll-rod-right"><rect x="736" y="20" width="44" height="460" rx="22" fill="#8C6A2F"/><rect x="744" y="20" width="10" height="460" fill="#fff" opacity=".18"/></g>'''
add('scroll','A horizontal parchment scroll between two wooden rods. Unroll it by animating .scroll-paper scaleX from the centre and moving the rods apart.', '0 0 800 500', body, parts=['.scroll-paper','.scroll-rod-left','.scroll-rod-right'])

# book shelf
cols=['#6E2B26','#1F4E43','#3E4E7A','#7A5A22','#4A3B2C']
heights=[400,440,380,430,410]
sp=[]
x=40
for i in range(5):
    w=[86,96,80,104,90][i]; h=heights[i]; y=480-h
    sp.append(f'<g class="book book-{i+1}"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="{cols[i]}"/><rect x="{x}" y="{y+30}" width="{w}" height="8" fill="#C9A24B"/><rect x="{x}" y="{y+h-46}" width="{w}" height="8" fill="#C9A24B"/><text x="{x+w/2+9}" y="{y+h/2}" transform="rotate(-90 {x+w/2+9} {y+h/2})" text-anchor="middle" font-family="Lora, serif" font-weight="700" font-size="24" fill="#F3E3C0">{{{{t{i+1}}}}}</text></g>')
    x+=w+10
body=f'''<rect class="shelf" x="10" y="480" width="{x+10}" height="26" fill="#5A4330"/>{''.join(sp)}'''
add('book-shelf','Five leather book spines on a shelf with vertical titles t1..t5 (short: "Ibn Hisham", "al-Tabari"...). Slide books up one by one as each source is named.', f'0 0 {x+30} 520', body, params={f't{i}':'' for i in range(1,6)}, parts=['.shelf','.book','.book-1 … .book-5'])

# scales of justice
body='''<g class="scales" stroke="var(--text)" stroke-width="6" fill="none" stroke-linecap="round">
<line class="scales-pillar" x1="200" y1="70" x2="200" y2="380"/><path class="scales-base" d="M130 390 h140" stroke-width="12"/>
<g class="scales-beam"><line x1="60" y1="90" x2="340" y2="90"/>
<g class="pan-left"><line x1="60" y1="90" x2="30" y2="210" stroke-width="3"/><line x1="60" y1="90" x2="90" y2="210" stroke-width="3"/><path d="M20 210 Q60 250 100 210 Z" fill="var(--accent)" stroke="var(--accent)"/></g>
<g class="pan-right"><line x1="340" y1="90" x2="310" y2="210" stroke-width="3"/><line x1="340" y1="90" x2="370" y2="210" stroke-width="3"/><path d="M300 210 Q340 250 380 210 Z" fill="var(--accent)" stroke="var(--accent)"/></g></g>
<circle cx="200" cy="70" r="12" fill="var(--accent)" stroke="none"/></g>'''
add('scales','Scales of justice. Tilt .scales-beam (transformOrigin 200px 90px) a few degrees and counter-rotate the pans to show weighing; level it for the ruling.', '0 0 400 420', body, parts=['.scales-beam','.pan-left','.pan-right','.scales-pillar','.scales-base'])

# reed pen + inkwell
body='''<g class="inkwell"><path d="M60 300 q0 -60 70 -60 h40 q70 0 70 60 v40 q0 20 -20 20 h-140 q-20 0 -20 -20z" fill="var(--text)"/><rect x="120" y="210" width="60" height="34" rx="6" fill="var(--text)"/><ellipse cx="150" cy="210" rx="34" ry="8" fill="#000" opacity=".5"/></g>
<g class="reed-pen"><path d="M150 205 L330 20 L342 30 L162 214 Z" fill="#C8A46A"/><path d="M150 205 L162 214 L140 232 Z" fill="var(--text)"/><line x1="200" y1="160" x2="300" y2="56" stroke="#8C6A2F" stroke-width="2"/></g>'''
add('reed-pen','A reed pen (qalam) resting in an inkwell. Lift the pen (.reed-pen) and draw an ink line elsewhere to "write".', '0 0 360 380', body, parts=['.inkwell','.reed-pen'])

# arch frame (pointed)
body='''<path class="arch-fill" d="M60 900 V420 Q60 200 300 60 Q540 200 540 420 V900 Z" fill="var(--bg2)"/>
<path class="arch-outline" d="M60 900 V420 Q60 200 300 60 Q540 200 540 420 V900" fill="none" stroke="var(--accent)" stroke-width="10"/>
<path class="arch-inner" d="M90 900 V430 Q90 225 300 100 Q510 225 510 430 V900" fill="none" stroke="var(--accent)" stroke-width="3" opacity=".7"/>'''
add('arch','A pointed arch frame (fill + gold outline). Draw the outline with stroke-dashoffset (length about 1900). Put text or another prop inside; rise the camera through it as a transition.', '0 0 600 920', body, parts=['.arch-fill','.arch-outline','.arch-inner'])

# dome skyline
def dome(x,base,w,h): return f'<path d="M{x} {base} v-{h*0.25} q0 -{h*0.75} {w/2} -{h*0.95} q{w/2} {h*0.2} {w/2} {h*0.95} v{h*0.25} z"/>'
def minaret(x,base,h): return f'<path d="M{x} {base} v-{h} l14 -40 l14 40 v{h} z"/><rect x="{x-6}" y="{base-h*0.62}" width="40" height="12"/>'
body=f'''<g class="skyline" fill="var(--text)">{minaret(120,400,240)}{dome(200,400,260,220)}<rect x="170" y="330" width="330" height="70"/>{minaret(520,400,280)}{dome(600,400,180,150)}{dome(800,400,220,180)}<rect x="590" y="350" width="480" height="50"/>{minaret(1080,400,200)}<rect x="0" y="398" width="1200" height="20"/></g>'''
add('dome-skyline','A silhouette skyline of generic domes and minarets (not a specific mosque) on a base line. Use as a horizon, at low opacity, or with a sunrise gradient behind.', '0 0 1200 420', body, parts=['.skyline'])

# lattice window
cells=''
for i in range(4):
    for j in range(5):
        cx=60+i*100; cy=60+j*100
        cells+=f'<polygon points="{P(star8(cx,cy,44,33))}"/><circle cx="{cx}" cy="{cy}" r="10"/>'
body=f'''<rect class="lattice-frame" x="0" y="0" width="420" height="520" rx="10" fill="var(--text)"/><rect x="10" y="10" width="400" height="500" fill="var(--accent)" opacity=".25"/><g class="lattice-holes" fill="var(--bg)" opacity=".9">{cells}</g>'''
add('lattice','A mashrabiya lattice window with star-shaped openings. Animate a light gradient behind it, or its light patch on a wall.', '0 0 420 520', body, parts=['.lattice-frame','.lattice-holes'])

# banner
body='''<line x1="20" y1="0" x2="20" y2="300" stroke="var(--text)" stroke-width="6"/><path class="banner-cloth" d="M24 10 h150 v170 l-75 40 l-75 -40 z" fill="var(--primary)"/><path d="M24 10 h150 v16 h-150z" fill="#000" opacity=".12"/><text class="banner-text" x="99" y="110" text-anchor="middle" font-family="Inter, sans-serif" font-weight="700" font-size="26" fill="var(--bg)">{{text}}</text>'''
add('banner','A standard banner on a pole for a community or tribe, with a short text (max ~8 letters, e.g. "AWS"). Recolour with CSS: .prop-banner .banner-cloth { fill: … }. Raise it (scaleY from the bottom of the pole).', '0 0 200 300', body, params={'text':''}, parts=['.banner-cloth','.banner-text'])

# palm
fronds=''.join(f'<path d="M150 90 q{60*math.cos(a):.0f} {-40+50*math.sin(a):.0f} {120*math.cos(a):.0f} {40+90*math.sin(a):.0f}" />' for a in [math.pi*k/7 + math.pi/14 - math.pi for k in range(8)] )
body=f'''<path class="palm-trunk" d="M140 400 q-10 -160 10 -310 h14 q-14 150 -4 310z" fill="#7A5A3A"/><g class="palm-fronds" fill="none" stroke="var(--primary)" stroke-width="16" stroke-linecap="round">{fronds}</g>'''
add('palm','A date palm. Sway .palm-fronds a few degrees (transformOrigin 150px 90px).', '0 0 300 400', body, parts=['.palm-trunk','.palm-fronds'])

# tent
body='''<path class="tent" d="M20 260 L160 40 L300 260 Z" fill="#C9A47A"/><path d="M160 40 L190 260 H130 Z" fill="#8C6A4A"/><path d="M0 262 H320" stroke="var(--text)" stroke-opacity=".3" stroke-width="4"/>'''
add('tent','A desert tent (camps, journeys, communities).', '0 0 320 270', body, parts=['.tent'])

# city wall with gate
crenels=''.join(f'<rect x="{x}" y="40" width="40" height="40"/>' for x in range(0,1000,80))
body=f'''<g class="wall" fill="#B89A6A">{crenels}<rect x="0" y="80" width="1000" height="220"/></g><path class="gate" d="M430 300 V200 Q500 120 570 200 V300 Z" fill="var(--text)" opacity=".85"/><g stroke="#000" stroke-opacity=".08" stroke-width="3">{''.join(f'<line x1="0" y1="{y}" x2="1000" y2="{y}"/>' for y in range(120,300,40))}</g>'''
add('city-wall','A crenellated city wall with an arched gate (cities, defence, protection). Build it up course by course or slide it up.', '0 0 1000 300', body, parts=['.wall','.gate'])

# timeline ruler
ticks=''.join(f'<line x1="{x}" y1="40" x2="{x}" y2="{70 if (x-50)%200==0 else 58}" />' for x in range(50,1160,50))
body=f'''<line class="tl-line" x1="50" y1="40" x2="1150" y2="40" stroke="var(--text)" stroke-width="4"/><g class="tl-ticks" stroke="var(--text)" stroke-width="3">{ticks}</g><g class="tl-marker"><circle cx="50" cy="40" r="14" fill="var(--accent)"/><circle cx="50" cy="40" r="24" fill="none" stroke="var(--accent)" stroke-width="3" opacity=".5"/></g>'''
add('timeline','A horizontal timeline ruler (ticks every 50 units, long ticks every 200). Put your own AH/CE labels as HTML above/below; slide .tl-marker (translate x) to the date.', '0 0 1200 90', body, parts=['.tl-line','.tl-ticks','.tl-marker'])

# lantern
body='''<line x1="100" y1="0" x2="100" y2="60" stroke="var(--text)" stroke-width="4"/><path class="lantern-cap" d="M60 60 h80 l-20 30 h-40z" fill="var(--accent)"/><path class="lantern-body" d="M60 90 h80 l20 120 l-60 60 l-60 -60 z" fill="var(--accent)" opacity=".85"/><path class="lantern-glow" d="M78 110 h44 l12 90 l-34 34 l-34 -34 z" fill="#FFE7A8" opacity=".9"/>'''
add('lantern','A hanging lantern; gently brighten .lantern-glow (opacity) for atmosphere (calm, never flickering fast).', '0 0 200 280', body, parts=['.lantern-cap','.lantern-body','.lantern-glow'])

# manuscript corner ornament
body=f'''<path class="corner" d="M10 10 H200 M10 10 V200" stroke="var(--accent)" stroke-width="8" fill="none"/><path d="M30 30 H160 M30 30 V160" stroke="var(--accent)" stroke-width="3" fill="none"/><polygon class="corner-star" points="{P(star8(70,70,34,26))}" fill="var(--accent)" opacity=".85"/><circle cx="70" cy="70" r="9" fill="var(--bg)"/>'''
add('corner-ornament','A gold manuscript corner ornament (two rules and a star). Use four, flipped with CSS transforms (scaleX(-1) / scaleY(-1)), to frame a page.', '0 0 210 210', body, parts=['.corner','.corner-star'])

json.dump({'_note':'Props for the Islamic scholarship styles. In a scene write <prop name="NAME" class="your-class" style="position:absolute;left:..;top:..;width:..px" text="..."></prop>; the bot replaces it with the SVG (params like text, t1..t5 fill the {{...}} slots). Colours follow the palette variables. Animate the listed parts with GSAP using your class: e.g. tl.from(".sc .my-map .city-medina", ...).','props':props}, open(f'{OUT}/props.json','w'), indent=2)
print(len(props),'props')
