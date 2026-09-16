"""Build original layered floating islands with Blender 5.2+."""
import math
from pathlib import Path
import bpy
from mathutils import Vector
ROOT = Path(__file__).resolve().parents[1]
OUT, SOURCE = ROOT/'public/assets', ROOT/'assets/blender'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
mat = bpy.data.materials.new('Layered weathered limestone')
mat.use_nodes = True
nodes, links = mat.node_tree.nodes, mat.node_tree.links
p = nodes.get('Principled BSDF')
p.inputs['Roughness'].default_value = .94
for filename, socket in [('rock-color.jpg','Base Color'),('rock-normal.jpg','Normal')]:
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(str(OUT/filename))
    output = tex.outputs['Color']
    if socket == 'Normal':
        tex.image.colorspace_settings.name = 'Non-Color'
        normal = nodes.new('ShaderNodeNormalMap')
        normal.inputs['Strength'].default_value = .65
        links.new(output, normal.inputs['Color'])
        output = normal.outputs['Normal']
    links.new(output,p.inputs[socket])
# Ring pairs cut horizontal ledges into continuous, closed cliff geometry.
profile = [(0,.08),(.25,.24),(.65,.38),(1,.49),(1.10,.61),(1.18,.53),
 (1.50,.66),(1.62,.81),(1.70,.73),(2.02,.84),(2.14,1),
 (2.22,.91),(2.52,1.03),(2.62,.97),(2.73,.75),(2.81,.42)]
objects=[]
for variant in range(1,4):
    for detail, sides in [('near',64),('far',20)]:
        verts, faces = [], []
        for ring,(z,r) in enumerate(profile):
            for i in range(sides):
                a=2*math.pi*i/sides
                outline=1+.10*math.sin(3*a+variant)+.065*math.cos(5*a-variant)
                # Same analytic silhouette at both detail levels.
                radius=2*r*outline*(1+.025*math.sin(11*a+ring*.7))
                x=radius*math.cos(a)+(2.8-z)*(.10 if variant==1 else -.13)
                y=radius*math.sin(a)*(1 if variant==1 else .72 if variant==2 else 1.14)
                height=z+.045*math.sin(4*a+variant)*min(r*3,1)
                verts.append((x,y,height))
        for ring in range(len(profile)-1):
            for i in range(sides):
                j=(i+1)%sides
                faces.append((ring*sides+i,ring*sides+j,(ring+1)*sides+j,(ring+1)*sides+i))
        faces.append(tuple(reversed(range(sides))))
        # Slightly domed planting shelf, free of deep cracks at the trunk seat.
        center=len(verts); verts.append((0,0,2.86))
        for i in range(sides):
            faces.append(((len(profile)-1)*sides+i,(len(profile)-1)*sides+(i+1)%sides,center))
        mesh=bpy.data.meshes.new(f'island-{variant}-{detail}')
        mesh.from_pydata(verts,[],faces); mesh.update()
        uv=mesh.uv_layers.new(name='Stone 1.6m')
        for face in mesh.polygons:
            axis=max(range(3),key=lambda k:abs(face.normal[k]))
            axes=[k for k in range(3) if k!=axis]
            for loop in face.loop_indices:
                v=mesh.vertices[mesh.loops[loop].vertex_index].co
                uv.data[loop].uv=(v[axes[0]]/1.6,v[axes[1]]/1.6)
        obj=bpy.data.objects.new(mesh.name,mesh)
        bpy.context.collection.objects.link(obj); mesh.materials.append(mat)
        objects.append(obj)
bpy.ops.export_scene.gltf(filepath=str(OUT/'gallery-islands.glb'),export_format='GLB',export_yup=True,export_meshopt_compression_enable=True)
for o in objects:
    o.location.x=(int(o.name.split('-')[1])-2)*5.3
    o.hide_render=o.name.endswith('far'); o.hide_set(o.hide_render)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'gallery-islands.blend'))
scene=bpy.context.scene
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.10,.14,.20,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45
for loc,power,color in [((1,-8,10),2300,(1,.80,.60)),((-6,4,7),2600,(.5,.7,1))]:
    bpy.ops.object.light_add(type='AREA',location=loc)
    o=bpy.context.object; o.data.energy=power; o.data.color=color; o.data.shape='DISK'; o.data.size=7
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
