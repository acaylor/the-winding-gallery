"""Build curb/flagstone kit: blender -b --python scripts/build-gallery-paving.py.

Three curb and two flagstone meshes share one limestone material. Source and
studio arrange them for editing; the client centers each mesh before instancing.
"""
import math
import random
import runpy
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/blender'
OUT = ROOT / 'public/assets'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
rng = random.Random(219)
stone_tools = runpy.run_path(str(ROOT/'scripts/gallery-stone.py'))
stone = stone_tools['limestone'](.25)


def block(name, width, length, height, loc, bevel):
    # An eight-sided outline with independently clipped corners. Jitter is baked
    # into each variant, not regenerated at runtime.
    w, l = width/2, length/2
    cuts = [rng.uniform(.018, .045) for _ in range(4)]
    outline = [(-w+cuts[0],-l),(w-cuts[1],-l),(w,-l+cuts[1]),
               (w,l-cuts[2]),(w-cuts[2],l),(-w+cuts[3],l),
               (-w,l-cuts[3]),(-w,-l+cuts[0])]
    outline = [(x+rng.uniform(-.006,.006),y+rng.uniform(-.006,.006)) for x,y in outline]
    verts = [(x,y,z) for z in [-height/2,height/2] for x,y in outline]
    # Gently uneven upper surface; triangulate the cap explicitly.
    for i in range(8,16):
        x,y,z=verts[i]
        verts[i]=(x,y,z+rng.uniform(-.008,.008))
    faces = [tuple(reversed(range(8)))] + [(8,8+i,9+i) for i in range(1,7)]
    faces += [(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts,[],faces)
    mesh.update()
    o=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(o)
    o.location=loc
    o.data.materials.append(stone)
    bpy.context.view_layer.objects.active=o
    o.select_set(True)
    mod=o.modifiers.new('Rounded worn edges','BEVEL')
    mod.width=bevel
    mod.segments=1
    mod.angle_limit=.25
    bpy.ops.object.modifier_apply(modifier=mod.name)
    stone_tools['stone_uvs'](o, (loc[0], loc[1]))
    for face in o.data.polygons:
        face.use_smooth=True
    mod=o.modifiers.new('Broad stone face normals','WEIGHTED_NORMAL')
    mod.keep_sharp=True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    o.select_set(False)


for i,(w,l,h) in enumerate([(.48,1.48,.24),(.47,1.46,.23),(.49,1.49,.25)]):
    block('curb-'+str(i+1),w,l,h,((i-1)*1.15,1,.18),.045)
for i,(w,l) in enumerate([(.9,.965),(.9,.965)]):
    block('flagstone-'+str(i+1),w,l,.12,((i-.5)*1.25,-.65,.08),.014)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT/'gallery-paving.glb'),export_format='GLB',use_selection=True,export_yup=True)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'gallery-paving.blend'))

floor=bpy.data.materials.new('Studio slate')
floor.diffuse_color=(.055,.085,.095,1)
bpy.ops.mesh.primitive_plane_add(size=200)
bpy.context.object.data.materials.append(floor)
scene=bpy.context.scene
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.16,.2,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45
for loc,power,color in [((1,-4,6),900,(1,.8,.59)),((-3,3,4),1100,(.52,.72,1))]:
    bpy.ops.object.light_add(type='AREA',location=loc)
    o=bpy.context.object
    o.data.energy=power
    o.data.color=color
    o.data.shape='DISK'
    o.data.size=4
    o.rotation_euler=(Vector((0,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(3,-5,5))
scene.camera=bpy.context.object
scene.camera.rotation_euler=(Vector((0,.1,0))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera.data.type='ORTHO'
scene.camera.data.ortho_scale=5.2
scene.render.engine='CYCLES'
scene.cycles.samples=32
scene.cycles.use_denoising=True
scene.render.resolution_x=1400
scene.render.resolution_y=1000
scene.render.resolution_percentage=100
scene.render.filepath=str(SOURCE/'paving-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'paving-studio.blend'))
bpy.ops.render.render(write_still=True)
