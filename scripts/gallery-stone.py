"""Shared Blender limestone surface and metre-scale UVs for gallery kits."""
import math
from array import array
from pathlib import Path
import bpy

ASSETS = Path(__file__).resolve().parents[1] / 'public/assets'


def bake_limestone():
    """Regrade CC0 Rock035, retaining mineral detail and a tileable surface.

    Roughness follows the mineral field. Ordinary baked images keep the
    Blender and glTF materials identical, without unsupported shader nodes.
    """
    source = bpy.data.images.load(str(ASSETS / 'rock-color.jpg'), check_existing=True)
    width, height = source.size
    pixels = array('f', [0]) * (width * height * 4)
    source.pixels.foreach_get(pixels)
    color, rough = array('f'), array('f')
    for y in range(height):
        for x in range(width):
            i = (y * width + x) * 4
            grain = min(1, (pixels[i]*.2126 + pixels[i+1]*.7152 + pixels[i+2]*.0722) ** .5)
            u, v = math.tau*x/width, math.tau*y/height
            cloud = .94 + .08*math.sin(u+math.sin(v)) + .045*math.cos(2*v-u)
            value = (.17 + .38*grain) * cloud
            color.extend((value, value*.93, value*.82, 1))
            r = min(.96, max(.58, .93 - .34*grain + .04*math.sin(u-v)))
            rough.extend((r, r, r, 1))
    for name, data, space in [('limestone-color', color, 'sRGB'), ('limestone-roughness', rough, 'Non-Color')]:
        image = bpy.data.images.new(name, width, height)
        image.colorspace_settings.name = space
        image.pixels.foreach_set(data)
        image.filepath_raw = str(ASSETS / (name + '.png'))
        image.file_format = 'PNG'
        image.save()


def limestone(normal_strength=.35):
    if not (ASSETS / 'limestone-color.png').exists():
        bake_limestone()
    mat = bpy.data.materials.new('Weathered warm limestone')
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    p = nodes.get('Principled BSDF')
    for filename, socket in [('limestone-color.png', 'Base Color'),
                             ('limestone-roughness.png', 'Roughness'), ('rock-normal.jpg', 'Normal')]:
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(str(ASSETS / filename), check_existing=True)
        output = tex.outputs['Color']
        if socket != 'Base Color':
            tex.image.colorspace_settings.name = 'Non-Color'
        if socket == 'Normal':
            normal = nodes.new('ShaderNodeNormalMap')
            normal.inputs['Strength'].default_value = normal_strength
            links.new(output, normal.inputs['Color'])
            output = normal.outputs['Normal']
        links.new(output, p.inputs[socket])
    return mat


def stone_uvs(obj, offset=(0, 0), scale=1.6):
    """Project in source metres, including bevels, with deterministic offsets."""
    while obj.data.uv_layers:
        obj.data.uv_layers.remove(obj.data.uv_layers[0])
    uv = obj.data.uv_layers.new(name='Stone metres')
    for face in obj.data.polygons:
        axis = max(range(3), key=lambda k: abs(face.normal[k]))
        axes = [k for k in range(3) if k != axis]
        for loop in face.loop_indices:
            v = obj.data.vertices[obj.data.loops[loop].vertex_index].co
            uv.data[loop].uv = (v[axes[0]]/scale+offset[0], v[axes[1]]/scale+offset[1])


if __name__ == '__main__':
    bake_limestone()
