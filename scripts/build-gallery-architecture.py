"""Build architecture: blender -b --python scripts/build-gallery-architecture.py.

Meters, Blender Z-up -> glTF Y-up. Gate labels remain runtime geometry at
app y=4, z=+/-0.52. Gate flames remain at x=+/-3.5, y=4.19.
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
rng = random.Random(71)


def material(name, color, metal=0, rough=.85):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    return m


stone = material('Weathered blue limestone', (.28, .32, .34))
p = stone.node_tree.nodes.get('Principled BSDF')
for filename, socket in [('rock-color.jpg', 'Base Color'), ('rock-normal.jpg', 'Normal')]:
    tex = stone.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(str(OUT / filename))
    output = tex.outputs['Color']
    if socket == 'Normal':
        tex.image.colorspace_settings.name = 'Non-Color'
        normal = stone.node_tree.nodes.new('ShaderNodeNormalMap')
        normal.inputs['Strength'].default_value = .4
        stone.node_tree.links.new(output, normal.inputs['Color'])
        output = normal.outputs['Normal']
    stone.node_tree.links.new(output, p.inputs[socket])
slate = material('Recessed slate', (.055, .085, .095))
brass = material('Worn champagne brass', (.53, .32, .12), .78, .4)


def finish(o, name, mat, bevel):
    o.name = name
    o.data.materials.append(mat)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new('Worn arris', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # World-scale planar UVs, including bevel faces, rather than stretched cube UVs.
    while o.data.uv_layers:
        o.data.uv_layers.remove(o.data.uv_layers[0])
    uv = o.data.uv_layers.new(name='Stone meters')
    for face in o.data.polygons:
        axis = max(range(3), key=lambda i: abs(face.normal[i]))
        axes = [i for i in range(3) if i != axis]
        for loop in face.loop_indices:
            v = o.matrix_world @ o.data.vertices[o.data.loops[loop].vertex_index].co
            uv.data[loop].uv = (v[axes[0]] / 1.6, v[axes[1]] / 1.6)
        face.use_smooth = True
    mod = o.modifiers.new('Stone face normals', 'WEIGHTED_NORMAL')
    mod.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return o


def box(name, loc, size, mat=stone, bevel=.035):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.scale = size
    return finish(o, name, mat, bevel)


def diamond(x, y, z, size=.13):
    o = box('Brass diamond inlay', (x, y, z), (size, .018, size), brass, .008)
    o.rotation_euler.y = math.pi / 4


def pillar(x, height, width):
    box('Foundation', (x, 0, .12), (width+.3, 1.15, .24))
    box('Sloped foot course', (x, 0, .30), (width+.14, 1.0, .12))
    count = max(2, round((height-.6)/.48))
    step = (height-.6)/count
    for i in range(count):
        box('Individual pillar course', (x+rng.uniform(-.012,.012), 0, .36+(i+.5)*step),
            (width+rng.uniform(-.018,.018), .86, step-.022), bevel=rng.uniform(.025,.055))
    box('Capital shadow course', (x, 0, height-.17), (width+.1,.96,.10), slate)
    box('Capital cornice', (x, 0, height-.06), (width+.28,1.10,.12))
    for face in [-1, 1]:
        diamond(x, face*.443, min(1.0,height/2))


def export(name):
    # One mesh per material; clones in the gallery share these resources.
    for mat in [stone, slate, brass]:
        objects = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.data.materials[0] == mat]
        if not objects:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        objects[0].name = name + ' — ' + mat.name
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(OUT / (name+'.glb')), export_format='GLB', use_selection=True, export_yup=True)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / (name+'.blend')))
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)


# Semicircular voussoirs: each wedge is a separate cut stone with an open joint.
for x in [-4.1, 4.1]:
    pillar(x, 1.45, .8)
count = 19
for i in range(count):
    a, b = i*math.pi/count+.003, (i+1)*math.pi/count-.003
    outer = 4.45 + (.14 if i == count//2 else rng.uniform(-.025,.025))
    inner = 3.75 - (.06 if i == count//2 else 0)
    vertices = [(r*math.cos(t), y, 1.40+r*math.sin(t))
                for y in [-.43,.43] for r,t in [(inner,a),(outer,a),(outer,b),(inner,b)]]
    mesh = bpy.data.meshes.new('Cut wedge')
    mesh.from_pydata(vertices, [], [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    mesh.update()
    o = bpy.data.objects.new('Voussoir', mesh)
    bpy.context.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    # Recalculate normals for the wedge winding before beveling.
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    finish(o, 'Crown keystone' if i == count//2 else 'Arch voussoir', stone, rng.uniform(.025,.045))
for face in [-1,1]:
    diamond(0,face*.447,5.57,.19)
export('gallery-arch')

# Gate geometry stays behind the existing two-sided wing-name planes.
for x in [-3.5,3.5]:
    pillar(x,3.60,.9)
    box('Crown block', (x,0,3.75), (1.2,1.10,.28))
    box('Flame socket', (x,0,3.94), (.38,.38,.10), brass,.025)
for i in range(9):
    box('Lintel course', ((i-4)*.85,0,4), (.832,.94,.70), bevel=.03)
box('Lintel lower molding', (0,0,3.62), (7.88,1.0,.10))
box('Lintel cornice', (0,0,4.40), (8.0,1.08,.14))
for face in [-1,1]:
    box('Recessed inscription bed', (0,face*.485,4), (5.12,.035,.65), slate,.012)
    for z in [3.66,4.34]:
        box('Inscription brass fillet', (0,face*.50,z), (5.20,.016,.018), brass,.005)
    for x in [-2.90,2.90]:
        diamond(x,face*.486,4,.18)
export('gallery-waygate')

# Shared review scene with both models; also useful for manual art direction.
for name,x in [('gallery-arch',-5.2),('gallery-waygate',5.2)]:
    bpy.ops.import_scene.gltf(filepath=str(OUT/(name+'.glb')))
    for o in bpy.context.selected_objects:
        if o.parent is None:
            o.location.x += x
box('Studio floor',(0,0,-.12),(200,200,.2),slate)
scene=bpy.context.scene
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.16,.2,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45
for loc,power,color,size in [((0,-8,12),3500,(1,.8,.59),9),((-8,2,10),3000,(.52,.72,1),8)]:
    bpy.ops.object.light_add(type='AREA',location=loc)
    o=bpy.context.object
    o.data.energy=power
    o.data.color=color
    o.data.shape='DISK'
    o.data.size=size
    o.rotation_euler=(Vector((0,0,2))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(11,-27,12))
scene.camera=bpy.context.object
scene.camera.rotation_euler=(Vector((0,0,2.7))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera.data.type='ORTHO'
scene.camera.data.ortho_scale=22
scene.render.engine='CYCLES'
scene.cycles.samples=32
scene.cycles.use_denoising=True
scene.render.resolution_x=1800
scene.render.resolution_y=900
scene.render.resolution_percentage=100
scene.render.filepath=str(SOURCE/'architecture-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'architecture-studio.blend'))
bpy.ops.render.render(write_still=True)
