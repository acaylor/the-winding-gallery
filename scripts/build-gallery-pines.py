"""Build mountain pines: blender -b --python scripts/build-gallery-pines.py.

Three meter-scale silhouettes, each with near/far wood and needle meshes plus
separate roots for terrain fitting. Needles are opaque geometry, not alpha cards.
"""
import math
import random
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets'
SOURCE = ROOT / 'assets/blender'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0


def material(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = .95
    return m


bark = material('Weathered mountain pine bark', (.28, .21, .14))
p = bark.node_tree.nodes.get('Principled BSDF')
for filename, socket in [('bark-color.jpg', 'Base Color'), ('bark-normal.jpg', 'Normal')]:
    tex = bark.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(str(OUT / filename))
    output = tex.outputs['Color']
    if socket == 'Normal':
        tex.image.colorspace_settings.name = 'Non-Color'
        normal = bark.node_tree.nodes.new('ShaderNodeNormalMap')
        normal.inputs['Strength'].default_value = .8
        bark.node_tree.links.new(output, normal.inputs['Color'])
        output = normal.outputs['Normal']
    bark.node_tree.links.new(output, p.inputs[socket])
foliage = material('Pine needles — sage tips', (.12, .22, .07))
attr = foliage.node_tree.nodes.new('ShaderNodeVertexColor')
attr.layer_name = 'Needle tint'
foliage.node_tree.links.new(attr.outputs['Color'], foliage.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
foliage.use_backface_culling = False


class Mesh:
    def __init__(self):
        self.vertices, self.faces, self.uvs, self.colors = [], [], [], []
        self.smooth_faces = set()

    def vertex(self, p, uv=(0, 0), color=(1, 1, 1, 1)):
        self.vertices.append(tuple(p))
        self.uvs.append(uv)
        self.colors.append(color)
        return len(self.vertices)-1

    def object(self, name, mat):
        data = bpy.data.meshes.new(name)
        data.from_pydata(self.vertices, [], self.faces)
        data.update()
        uv = data.uv_layers.new(name='Bark scale')
        color = data.color_attributes.new(name='Needle tint', type='FLOAT_COLOR', domain='POINT')
        for i, c in enumerate(self.colors):
            color.data[i].color = c
        for face in data.polygons:
            face.use_smooth = mat == bark or face.index in self.smooth_faces
            for loop in face.loop_indices:
                uv.data[loop].uv = self.uvs[data.loops[loop].vertex_index]
        o = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(o)
        o.data.materials.append(mat)
        return o


def curve(points, steps):
    """Catmull-Rom samples keep the same silhouette at both detail levels."""
    pts = [Vector(p) for p in points]
    result = []
    for i in range(steps+1):
        t = i / steps * (len(pts)-1)
        k = min(int(t), len(pts)-2)
        u = t-k
        a,b,c,d = pts[max(0,k-1)],pts[k],pts[k+1],pts[min(len(pts)-1,k+2)]
        result.append(.5*((2*b)+(-a+c)*u+(2*a-5*b+4*c-d)*u*u+(-a+3*b-3*c+d)*u*u*u))
    return result


def tube(mesh, points, radius, tip, steps=12, sides=7):
    pts = curve(points, steps)
    start = len(mesh.vertices)
    distance = 0
    for i, p in enumerate(pts):
        tangent = (pts[min(i+1,steps)]-pts[max(0,i-1)]).normalized()
        reference = Vector((0,1,0)) if abs(tangent.y) < .9 else Vector((1,0,0))
        a = tangent.cross(reference).normalized()
        b = tangent.cross(a).normalized()
        if i:
            distance += (p-pts[i-1]).length
        r = (radius*(1-i/steps)+tip*i/steps) * (1 + .10*math.sin(i*2.1))
        for j in range(sides+1):
            angle = j/sides*math.tau
            mesh.vertex(p + r*(a*math.cos(angle)+b*math.sin(angle)), (j/sides*max(radius*12,.5), distance/.65))
        if i:
            for j in range(sides):
                n = start+(i-1)*(sides+1)+j
                mesh.faces.append((n,n+1,n+sides+2,n+sides+1))
    mesh.faces.append(tuple(start+j for j in reversed(range(sides))))
    mesh.faces.append(tuple(start+steps*(sides+1)+j for j in range(sides)))


def needles(mesh, center, size, seed, low):
    """Overlapping twig sprays, with needles growing along a directional axis.

    The distant version keeps the same occupied volume with fewer wider blades.
    Neither version uses transparency, so shadows and AO see the actual crown.
    """
    r = random.Random(seed)
    angle = r.uniform(0, math.tau)
    axis = Vector((math.cos(angle), math.sin(angle), r.uniform(.15,.45))).normalized()
    across = axis.cross(Vector((0,0,1))).normalized()
    # A dark rounded inner crown keeps foliage legible once needles become
    # subpixel. Smooth normals and an irregular outline avoid visible flat pads.
    start, face_start = len(mesh.vertices), len(mesh.faces)
    sides = 4 if low else 6
    for z in [-.065,.065]:
        for k in range(sides):
            a=k*math.tau/sides+.3
            radius=.60+.08*math.sin(k*2.7+seed)
            v=center+axis*(math.cos(a)*size*radius)+across*(math.sin(a)*size*.35)
            v.z += z*size
            mesh.vertex(v, color=(.012,.035,.014,1))
    bottom=mesh.vertex(center+Vector((0,0,-.18*size)),color=(.009,.024,.01,1))
    top=mesh.vertex(center+Vector((0,0,.18*size)),color=(.025,.060,.022,1))
    for k in range(sides):
        j=(k+1)%sides
        mesh.faces.extend([(bottom,start+j,start+k),
                           (start+k,start+j,start+sides+j,start+sides+k),
                           (top,start+sides+k,start+sides+j)])
    mesh.smooth_faces.update(range(face_start,len(mesh.faces)))
    count = 6 if low else 56
    for i in range(count):
        t = r.uniform(-.85, .85)
        flank = -1 if i % 2 else 1
        base = center + axis*t*size + across*r.uniform(-.22,.22)*size
        base.z += r.uniform(-.16,.16)*size
        direction = (axis*r.uniform(.2,.7) + across*flank*r.uniform(.4,1) +
                     Vector((0,0,r.uniform(-.2,.9)))).normalized()
        length = size*r.uniform(.42,.82)
        tip = base + direction*length
        side = direction.cross(Vector((.1,.2,1))).normalized()
        width = size*(.13 if low else .035)
        mid = base.lerp(tip,.45)
        tint = r.uniform(.75,1.20)
        dark = (.025*tint,.060*tint,.027*tint,1)
        light = (.105*tint,.19*tint,.065*tint,1)
        if low:
            n = mesh.vertex(base-side*width, color=dark)
            mesh.vertex(base+side*width, color=light)
            mesh.vertex(tip, color=light)
            mesh.faces.append((n,n+1,n+2))
        else:
            n = mesh.vertex(base, color=dark)
            mesh.vertex(mid+side*width, color=light)
            mesh.vertex(tip, color=light)
            mesh.vertex(mid-side*width, color=light)
            mesh.faces.extend([(n,n+1,n+2),(n,n+2,n+3)])


# Branch lengths and directions intentionally differ; the third tree has a fork.
DESIGNS = [
    ('sentinel', [(0,0,0),(-.12,.02,.8),(.10,.02,1.65),(.48,0,2.55),(.8,.08,3.35)],
     [(.29,2.9,1.35),(.43,-.25,1.65),(.49,1.55,1.1),(.60,3.9,1.3),(.69,1.45,1.2),(.77,-.4,1.0),(.88,2.5,.65)]),
    ('windswept', [(0,0,0),(.14,.03,.65),(.48,-.04,1.35),(1.05,0,2.0),(1.55,.05,2.65)],
     [(.26,2.7,.95),(.40,.15,1.8),(.50,1.6,1.12),(.57,-.65,1.50),(.68,3.0,.85),(.77,.60,1.25),(.88,-.5,.8)]),
    ('forked', [(0,0,0),(-.18,0,.85),(-.12,.08,1.7),(.3,.10,2.65),(.50,.1,3.5)],
     [(.27,3.15,1.25),(.41,-.45,1.6),(.51,1.6,1.2),(.64,3.7,1.3),(.73,1.55,1.25),(.86,-.2,.9)]),
]
for variant, (label, trunk, branches) in enumerate(DESIGNS,1):
    trunk_samples = curve(trunk,100)
    for low in [False,True]:
        wood, leaf = Mesh(), Mesh()
        tube(wood,trunk,.22,.035,steps=10 if low else 26,sides=5 if low else 10)
        terminals = []
        for bi,(fraction,angle,length) in enumerate(branches):
            at = trunk_samples[round(fraction*100)]
            direction = Vector((math.cos(angle),math.sin(angle),0))
            tip = at+direction*length+Vector((0,0,.22+math.sin(bi*2.7)*.16))
            branch = [at,at+direction*length*.32+Vector((0,0,-.20)),at+direction*length*.73+Vector((.08,-.07,-.12)),tip]
            tube(wood,branch,.075*(1-fraction*.5),.012,steps=3 if low else 9,sides=4 if low else 6)
            for ti in range(4):
                t = .25+ti*.22
                fork_at = curve(branch,100)[round(t*100)]
                az = angle+(-1 if ti%2 else 1)*(.65+.12*math.sin(bi+ti))
                end = fork_at+Vector((math.cos(az)*.52,math.sin(az)*.52,.12+.10*math.sin(ti)))
                tube(wood,[fork_at,end],.018,.005,steps=1 if low else 3,sides=4)
                for ni in range(3):
                    terminals.append((end+Vector(((ni-1)*.14,math.sin(ni*2+bi)*.13,ni*.035)),.34 if fraction<.7 else .29))
        # Needle-bearing crown branches are visible between the sprays.
        crown=Vector(trunk[-1])
        for ci in range(7):
            a=ci/7*math.tau
            end=crown+Vector((math.cos(a)*.40,math.sin(a)*.40,.10-abs(math.cos(a))*.1))
            tube(wood,[crown-Vector((0,0,.2)),end],.024,.006,steps=2,sides=4)
            terminals.extend([(end,.40),(end+Vector((.13,.1,.12)),.33)])
        if label == 'forked':
            at=trunk_samples[52]
            end=at+Vector((-1.0,.22,1.36))
            tube(wood,[at,at+Vector((-.6,.1,.55)),end],.08,.02,steps=5 if low else 10,sides=5 if low else 7)
            for ci in range(8):
                a=ci/8*math.tau
                terminals.append((end+Vector((math.cos(a)*.33,math.sin(a)*.33,0)),.28))
        for ni,(center,size) in enumerate(terminals):
            needles(leaf,center,size*1.15,variant*1000+ni,low)
        level='far' if low else 'near'
        wood.object(f'pine-{variant}-{level}-wood',bark)
        leaf.object(f'pine-{variant}-{level}-needles',foliage)
    roots=Mesh()
    for ri in range(5):
        a=ri/5*math.tau+variant*.4
        d=Vector((math.cos(a),math.sin(a),0))
        tube(roots,[Vector((0,0,.1)),d*.25+Vector((0,0,.035)),d*.55+Vector((0,0,.015)),d*.8-Vector((0,0,.06))],.09,.012,steps=5,sides=5)
    roots.object(f'pine-{variant}-roots',bark)

# Every mesh is rooted at zero so the loader can assemble matching near/far groups.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT/'gallery-pines.glb'),export_format='GLB',use_selection=True,export_yup=True,
                               export_meshopt_compression_enable=True)
# Arrange editable sources for inspection, with far meshes hidden in the source scene.
for o in bpy.context.scene.objects:
    variant=int(o.name.split('-')[1])
    o.location.x=(variant-2)*4.4
    o.hide_render='-far-' in o.name
    o.hide_set(o.hide_render)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'gallery-pines.blend'))

floor=material('Studio slate',(.055,.085,.095))
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.08))
bpy.context.object.data.materials.append(floor)
scene=bpy.context.scene
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.16,.2,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45
for loc,power,color,size in [((2,-6,8),1800,(1,.8,.59),7),((-5,3,6),2200,(.52,.72,1),6)]:
    bpy.ops.object.light_add(type='AREA',location=loc)
    o=bpy.context.object
    o.data.energy=power
    o.data.color=color
    o.data.shape='DISK'
    o.data.size=size
    o.rotation_euler=(Vector((0,0,1.5))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(8,-19,8))
scene.camera=bpy.context.object
scene.camera.rotation_euler=(Vector((.5,0,1.6))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera.data.type='ORTHO'
scene.camera.data.ortho_scale=15
scene.render.engine='CYCLES'
scene.cycles.samples=48
scene.cycles.use_denoising=True
scene.render.resolution_x=1800
scene.render.resolution_y=1000
scene.render.resolution_percentage=100
scene.render.filepath=str(SOURCE/'pines-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'pines-studio.blend'))
bpy.ops.render.render(write_still=True)
