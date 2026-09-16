"""Rebuild original gallery props: blender -b --python scripts/build-gallery-assets.py.

Meters, Z up in Blender; GLB exports Y up. Geometry is merged by material
for inexpensive shared clones. No external asset downloads are required.
"""
import bpy
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets'
SOURCE = ROOT / 'assets/blender'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0

def material(name, color, metal=0, rough=.5, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    return m

bronze = material('Oil-rubbed bronze', (.105, .067, .032), .78, .48)
gold = material('Worn champagne brass', (.53, .32, .12), .72, .46)
stone = material('Blue limestone', (.24, .29, .31), 0, .86)
dark = material('Recessed slate', (.055, .085, .095), 0, .9)
opal = material('Honey opal', (1, .47, .12), .05, .32, 2.5)
for metal in (bronze, gold):
    attr = metal.node_tree.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Recess patina'
    metal.node_tree.links.new(attr.outputs['Color'], metal.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
# Real image-backed stone detail survives GLB export (procedural shader nodes do not).
p = stone.node_tree.nodes.get('Principled BSDF')
uv = stone.node_tree.nodes.new('ShaderNodeTexImage')
uv.image = bpy.data.images.load(str(OUT / 'rock-color.jpg'))
stone.node_tree.links.new(uv.outputs['Color'], p.inputs['Base Color'])
n = stone.node_tree.nodes.new('ShaderNodeTexImage')
n.image = bpy.data.images.load(str(OUT / 'rock-normal.jpg'))
n.image.colorspace_settings.name = 'Non-Color'
normal = stone.node_tree.nodes.new('ShaderNodeNormalMap')
normal.inputs['Strength'].default_value = .35
stone.node_tree.links.new(n.outputs['Color'], normal.inputs['Color'])
stone.node_tree.links.new(normal.outputs['Normal'], p.inputs['Normal'])

def finish(obj, name, mat, bevel=0):
    obj.name = name
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('Crafted edge bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for face in obj.data.polygons:
        face.use_smooth = True
    mod = obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    if mat == stone:
        uv = obj.data.uv_layers.active or obj.data.uv_layers.new(name='Stone 1.6m')
        for face in obj.data.polygons:
            axis = max(range(3), key=lambda k: abs(face.normal[k]))
            axes = [k for k in range(3) if k != axis]
            for loop in face.loop_indices:
                co = obj.matrix_world @ obj.data.vertices[obj.data.loops[loop].vertex_index].co
                uv.data[loop].uv = (co[axes[0]]/1.6, co[axes[1]]/1.6)
    if mat in (bronze, gold):
        tint = obj.data.color_attributes.new(name='Recess patina', type='FLOAT_COLOR', domain='CORNER')
        for face in obj.data.polygons:
            # Sheltered downward faces darken; upper edges retain rubbed highlights.
            shade = .57 if face.normal.z < -.25 else .94 if face.normal.z > .4 else .80
            for loop in face.loop_indices:
                co = obj.data.vertices[obj.data.loops[loop].vertex_index].co
                wear = .035*math.sin(co.x*97+co.y*71+co.z*39)
                tint.data[loop].color = ((shade+wear)*mat.diffuse_color[0], (shade+wear)*mat.diffuse_color[1], (shade*.94+wear)*mat.diffuse_color[2], 1)
    return obj

def cone(name, z, r1, r2, depth, mat, x=0, y=0, vertices=64, bevel=.008):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2,
                                  depth=depth, location=(x, y, z))
    return finish(bpy.context.object, name, mat, bevel)

def box(name, loc, size, mat, bevel=.01):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, name, mat, bevel)

def tube(name, points, radius, mat):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new('POLY')
    spline.points.add(len(points)-1)
    for p, co in zip(spline.points, points):
        p.co = (*co, 1)
    o = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH')
    return finish(o, name, mat)

def export(name):
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for mat in {o.data.materials[0] for o in meshes}:
        bpy.ops.object.select_all(action='DESELECT')
        group = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.data.materials[0] == mat]
        for o in group:
            o.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.join()
        group[0].name = name + ' — ' + mat.name
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(OUT / (name + '.glb')), export_format='GLB',
                              use_selection=True, export_yup=True)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / (name + '.blend')))
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)

# A turned, fluted bronze post and a swept swan-neck support.
for z, a, b, h, mat in [(.06,.26,.26,.12,stone),(.16,.19,.15,.08,bronze),
                        (.23,.15,.09,.06,gold),(.34,.09,.065,.16,bronze),
                        (1.36,.047,.036,1.9,bronze),(2.34,.065,.065,.06,gold)]:
    cone('Turned post',z,a,b,h,mat)
for i in range(12):
    a = i * math.tau / 12
    tube('Post fluting',[(.045*math.cos(a),.045*math.sin(a),.49),
                         (.036*math.cos(a),.036*math.sin(a),2.26)],.004,gold)
points = [(0,0,2.32)] + [(.37-.37*math.cos(t),0,2.32+.48*math.sin(t))
                          for t in [i*math.pi/48 for i in range(49)]]
tube('Swan neck',points,.035,bronze)
tube('Inner scroll',[(.32+.22*math.cos(t),0,2.43+.19*math.sin(t))
                     for t in [i*math.pi*1.65/60 for i in range(61)]],.012,gold)
cone('Suspension',2.33,.022,.022,.19,gold,x=.74)
for z,r1,r2,h,mat in [(1.68,.18,.22,.07,bronze),(1.73,.23,.23,.035,gold),
                      (1.95,.16,.16,.39,opal),(2.18,.23,.23,.04,gold),
                      (2.24,.28,.07,.1,bronze),(2.31,.07,.025,.055,gold)]:
    cone('Lantern housing',z,r1,r2,h,mat,x=.74,vertices=8)
for i in range(8):
    a = (i+.5)*math.tau/8
    x,y = .74+.195*math.cos(a), .195*math.sin(a)
    tube('Cage mullion',[(x,y,1.75),(x,y,2.16)],.012,bronze)
    for z in [1.77,2.14]:
        cone('Rivet',z,.02,.02,.024,gold,x=x,y=y,vertices=12,bevel=.004)
cone('Lower finial',1.61,.025,.09,.09,gold,x=.74)
export('keeper-lantern')

# An octagonal carved pedestal with inset panels, brass fillets and a stepped cornice.
for z,r1,r2,h,mat in [(.055,.82,.82,.11,stone),(.145,.79,.72,.07,stone),
                     (.205,.7,.7,.05,dark),(.25,.69,.58,.06,stone),
                     (.64,.55,.49,.72,stone), (1.025,.5,.59,.07,stone),
                     (1.077,.61,.61,.025,gold),(1.12,.64,.66,.06,stone),
                     (1.185,.69,.69,.07,stone),(1.23,.67,.64,.02,gold)]:
    cone('Carved octagonal courses',z,r1,r2,h,mat,vertices=8,bevel=.012)
for i in range(8):
    a = (i+.5)*math.tau/8
    o = box('Inset slate panel',(.491*math.cos(a),.491*math.sin(a),.66),
            (.018,.25,.48),dark,.014)
    o.rotation_euler.z = a
    for side in [-1,1]:
        tangent = Vector((-math.sin(a),math.cos(a),0)) * side*.145
        center = Vector((.5*math.cos(a),.5*math.sin(a),.66)) + tangent
        o = box('Panel brass fillet',center,(.018,.012,.5),gold,.004)
        o.rotation_euler.z = a
    # Raised diamond ornament centered on each inset.
    o = box('Diamond inlay',(.505*math.cos(a),.505*math.sin(a),.69),
            (.025,.083,.083),gold,.005)
    o.rotation_euler = (math.pi/4,0,a)
export('gallery-plinth')

# A small corner inlay: two tapered leaves and a raised central diamond.
# Origin is the top-right photo corner; all detail stays outside the image.
for points in [[(.073,.073,.100),(-.03,.080,.102),(-.14,.066,.088)],
               [(.073,.073,.100),(.080,-.03,.102),(.066,-.14,.088)]]:
    tube('Corner leaf vein', points, .005, gold)
for x,y,angle in [(-.03,.074,-.12),(.074,-.03,math.pi/2+.12)]:
    o=box('Corner leaf',(x,y,.09),(.15,.025,.016),gold,.008)
    o.rotation_euler.z=angle
ornament=box('Corner diamond',(.073,.073,.095),(.06,.06,.025),gold,.008)
ornament.rotation_euler.z=math.pi/4
for o in list(bpy.context.scene.objects):
    if o.type == 'MESH':
        # Bake before the global rotation so the kit retains a zero corner origin.
        bpy.context.view_layer.objects.active=o
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True)
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        o.rotation_euler.x=math.pi/2
export('gallery-frame-corner')

# A reusable studio scene also provides a quick honest geometry/material review.
for name, x in [('keeper-lantern',-1),('gallery-plinth',1)]:
    bpy.ops.import_scene.gltf(filepath=str(OUT / (name+'.glb')))
    for o in bpy.context.selected_objects:
        if o.parent is None:
            o.location.x += x
box('Studio floor',(0,0,-.08),(200,200,.1),dark)
world = bpy.context.scene.world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.12,.16,.2,1)
world.node_tree.nodes['Background'].inputs[1].default_value = .4
for loc,power,color,size in [((1,-4,5),950,(1,.8,.59),4),((-3,1,4),1200,(.52,.72,1),3),((3,3,3),800,(1,.9,.7),2)]:
    bpy.ops.object.light_add(type='AREA',location=loc)
    o=bpy.context.object
    o.data.energy=power
    o.data.color=color
    o.data.shape='DISK'
    o.data.size=size
    o.rotation_euler=(Vector((0,0,1.2))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(4,-7,3.8))
camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,1.35))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'
camera.data.ortho_scale=4.8
scene=bpy.context.scene
scene.camera=camera
scene.render.engine='CYCLES'
scene.cycles.samples=32
scene.cycles.use_denoising=True
scene.render.resolution_x=1400
scene.render.resolution_y=1200
scene.render.resolution_percentage=100
scene.render.filepath=str(SOURCE/'props-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'props-studio.blend'))
bpy.ops.render.render(write_still=True)
