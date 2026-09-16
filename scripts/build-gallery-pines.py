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
        normal.inputs['Strength'].default_value = .45
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
            face.use_smooth = mat == bark
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
        r = radius*(1-i/steps)+tip*i/steps
        for j in range(sides+1):
            angle = j/sides*math.tau
            mesh.vertex(p + r*(a*math.cos(angle)+b*math.sin(angle)), (j/sides, distance/.45))
        if i:
            for j in range(sides):
                n = start+(i-1)*(sides+1)+j
                mesh.faces.append((n,n+1,n+sides+2,n+sides+1))
    mesh.faces.append(tuple(start+j for j in reversed(range(sides))))
    mesh.faces.append(tuple(start+steps*(sides+1)+j for j in range(sides)))


def needles(mesh, center, size, seed, low):
    r = random.Random(seed)
    # An open spray of tapered needles in multiple planes. A broad center-to-tip
    # color gradient makes the pads legible in moonlight without luminous foliage.
    count = 20 if low else 64
    for i in range(count):
        angle = i/count*math.tau+r.uniform(-.13,.13)
        direction = Vector((math.cos(angle),math.sin(angle),r.uniform(-.25,.55))).normalized()
        length = size*r.uniform(.65,1.1)
        base = center+Vector((r.uniform(-.05,.05),r.uniform(-.05,.05),r.uniform(-.035,.035)))
        tip = base+direction*length
        side = direction.cross(Vector((.2,.1,1))).normalized()
        width = size*(.10 if low else .035)
        mid = base.lerp(tip,.35)
        tint = r.uniform(.8,1.18)
        dark = (.028*tint,.055*tint,.014*tint,1)
        light = (.085*tint,.17*tint,.04*tint,1)
        n = mesh.vertex(base, color=dark)
        mesh.vertex(mid+side*width, color=light)
        mesh.vertex(tip, color=light)
        mesh.vertex(mid-side*width, color=light)
        mesh.faces.extend([(n,n+1,n+2),(n,n+2,n+3)])


# Branch lengths and directions intentionally differ; the third tree has a fork.
DESIGNS = [
    ('sentinel', [(0,0,0),(-.12,.02,.8),(.10,.02,1.65),(.48,0,2.55),(.8,.08,3.35)],
     [( .37, 2.9,1.20),(.52,-.25,1.45),(.69,1.45,1.12),(.83,.25,.95)]),
    ('windswept', [(0,0,0),(.14,.03,.65),(.48,-.04,1.35),(1.05,0,2.0),(1.55,.05,2.65)],
     [(.35,2.7,.82),(.48,.15,1.65),(.65,-.65,1.30),(.83,.60,1.10)]),
    ('forked', [(0,0,0),(-.18,0,.85),(-.12,.08,1.7),(.3,.10,2.65),(.50,.1,3.5)],
     [(.34,3.15,1.05),(.49,-.45,1.42),(.69,1.55,1.15),(.86,-.2,.9)]),
]
for variant, (label, trunk, branches) in enumerate(DESIGNS,1):
    trunk_samples = curve(trunk,100)
    for low in [False,True]:
        wood, leaf = Mesh(), Mesh()
        tube(wood,trunk,.17,.025,steps=12 if low else 24,sides=5 if low else 9)
        terminals = []
        for bi,(fraction,angle,length) in enumerate(branches):
            at = trunk_samples[round(fraction*100)]
            direction = Vector((math.cos(angle),math.sin(angle),0))
            tip = at+direction*length+Vector((0,0,.15))
            branch = [at,at+direction*length*.4+Vector((0,0,-.12)),tip]
            tube(wood,branch,.075*(1-fraction*.5),.012,steps=5 if low else 9,sides=4 if low else 6)
            for ti in range(4):
                t = .40+ti*.19
                fork_at = curve(branch,100)[round(t*100)]
                az = angle+(-1 if ti%2 else 1)*.8
                end = fork_at+Vector((math.cos(az)*.38,math.sin(az)*.38,.17))
                tube(wood,[fork_at,end],.018,.005,steps=1 if low else 3,sides=4)
                for ni in range(3):
                    terminals.append((end+Vector(((ni-1)*.14,math.sin(ni*2+bi)*.13,ni*.035)),.26 if fraction<.7 else .23))
        # Needle-bearing crown branches are visible between the sprays.
        crown=Vector(trunk[-1])
        for ci in range(7):
            a=ci/7*math.tau
            end=crown+Vector((math.cos(a)*.40,math.sin(a)*.40,.10-abs(math.cos(a))*.1))
            tube(wood,[crown-Vector((0,0,.2)),end],.024,.006,steps=2,sides=4)
            terminals.extend([(end,.30),(end+Vector((.13,.1,.02)),.25)])
        if label == 'forked':
            at=trunk_samples[52]
            end=at+Vector((-1.0,.22,1.36))
            tube(wood,[at,at+Vector((-.6,.1,.55)),end],.08,.02,steps=5 if low else 10,sides=5 if low else 7)
            for ci in range(8):
                a=ci/8*math.tau
                terminals.append((end+Vector((math.cos(a)*.33,math.sin(a)*.33,0)),.28))
        for ni,(center,size) in enumerate(terminals):
            needles(leaf,center,size*1.3,variant*1000+ni,low)
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
