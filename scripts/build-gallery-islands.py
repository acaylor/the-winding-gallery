"""Build three fractured limestone masses with shared surfaces and cheap LODs."""
import random
import runpy
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT, SOURCE = ROOT/'public/assets', ROOT/'assets/blender'
stone = runpy.run_path(str(ROOT/'scripts/gallery-stone.py'))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
mat = stone['limestone'](.48)

# Individual footprints, shear directions and fractures: a broad mesa,
# a wind-cut prow and a squat buttress. No shared concentric ledge profile.
DESIGNS = [
    ([(-1.8,-.8),(-.6,-1.5),(.7,-1.35),(1.9,-.6),(1.45,.1),(1.85,.8),(.65,1.35),(-.7,1.1),(-1.95,.4)],
     [(0,.24),(.48,.49),(1.05,.80),(1.62,.94),(2.16,1.03),(2.63,.91)], (.48,-.24)),
    ([(-2.1,-.55),(-1.35,-1.0),(.25,-.83),(2.25,-.30),(1.45,.55),(.35,.90),(-.8,.65),(-1.65,.8)],
     [(0,.34),(.76,.57),(1.16,.74),(1.86,.79),(2.27,1.05),(2.66,.95)], (-.75,.1)),
    ([(-1.6,-1.2),(-.2,-1.0),(.55,-1.5),(1.6,-.55),(1.7,.65),(.55,1.5),(-.4,.95),(-1.65,.55)],
     [(0,.43),(.43,.70),(1.08,.88),(1.43,.81),(2.10,1.0),(2.58,.90)], (.2,.48)),
]


def crag(variant, footprint, profile, shear):
    rng = random.Random(481 + variant)
    n = len(footprint)
    verts, faces = [], []
    fault = [rng.uniform(-.16, .16) for _ in footprint]
    for level, (z, radius) in enumerate(profile):
        t = z / profile[-1][0]
        for i, (x, y) in enumerate(footprint):
            wear = rng.uniform(-.07,.07)
            lift = .14*x + .07*y + fault[i] + rng.uniform(-.075,.075)
            verts.append((x*(radius+wear)+shear[0]*(1-t),
                          y*(radius+wear)+shear[1]*(1-t), z+lift))
    for level in range(len(profile)-1):
        for i in range(n):
            j = (i+1)%n
            faces.append((level*n+i, level*n+j, (level+1)*n+j, (level+1)*n+i))
    faces.append(tuple(reversed(range(n))))
    center = len(verts)
    verts.append((0,0,profile[-1][0]+.04))
    for i in range(n):
        faces.append(((len(profile)-1)*n+i,(len(profile)-1)*n+(i+1)%n,center))
    mesh = bpy.data.meshes.new(f'Crag {variant}')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(f'island-{variant}-near', mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bevel = obj.modifiers.new('Chipped fracture edges', 'BEVEL')
    bevel.width = .045
    bevel.segments = 2
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    stone['stone_uvs'](obj, (variant*.37, variant*.61))
    for face in obj.data.polygons:
        face.use_smooth = True
    normal = obj.modifiers.new('Preserve broad rock planes', 'WEIGHTED_NORMAL')
    normal.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=normal.name)
    obj.select_set(False)
    far = obj.copy()
    far.data = obj.data.copy()
    far.name = f'island-{variant}-far'
    bpy.context.collection.objects.link(far)
    bpy.context.view_layer.objects.active = far
    decimate = far.modifiers.new('Distant silhouette', 'DECIMATE')
    decimate.ratio = .28
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    return obj, far


objects = []
for variant, design in enumerate(DESIGNS, 1):
    objects.extend(crag(variant, *design))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT/'gallery-islands.glb'), export_format='GLB',
                          export_yup=True, export_meshopt_compression_enable=True)
for o in objects:
    o.location.x = (int(o.name.split('-')[1])-2)*5.5
    o.hide_render = o.name.endswith('far')
    o.hide_set(o.hide_render)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'gallery-islands.blend'))
scene = bpy.context.scene
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.10,.14,.20,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .35
for loc,power,color in [((1,-8,10),2300,(1,.80,.60)),((-6,4,7),2600,(.5,.7,1))]:
    bpy.ops.object.light_add(type='AREA',location=loc)
    o=bpy.context.object
    o.data.energy=power; o.data.color=color; o.data.shape='DISK'; o.data.size=7
    o.rotation_euler=(Vector((0,0,1.4))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(8,-20,8))
scene.camera=bpy.context.object
scene.camera.rotation_euler=(Vector((0,0,1.3))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera.data.type='ORTHO'; scene.camera.data.ortho_scale=18
scene.render.engine='CYCLES'; scene.cycles.samples=32; scene.cycles.use_denoising=True
scene.render.resolution_x=1800; scene.render.resolution_y=900; scene.render.resolution_percentage=100
scene.render.filepath=str(SOURCE/'islands-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'islands-studio.blend'))
bpy.ops.render.render(write_still=True)
