import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.GZIPInputStream;
import javax.imageio.ImageIO;

// Exports a loc's model as a binary glTF (.glb) that Three's GLTFLoader can load.
// The model is built and lit by the client itself (LocType.getModel), so colours match the game:
// - gouraud/flat faces get their palette colours (Draw3D.palette) as vertex colours
// - textured faces get UVs from the model's P/M/N texture vertices, the texture as an embedded PNG
//   and the client's shade level as a grey vertex colour (glTF multiplies it with the texture)
// - faceAlpha becomes vertex alpha
// Materials are unlit (KHR_materials_unlit) because the lighting is already baked in.
// Coordinates: RS is x east, y down, z north with 128 units per tile; glTF gets (x, -y, -z) / 128,
// a 180 degree turn around x, so one unit is one tile, y is up and north is -z.
//
// A loc has a model per kind (wall, roof, centrepiece...) and the client rotates and mirrors it
// before lighting it, so each variant the maps use is exported separately: the loc files of every
// map square are scanned for the loc's placements (kind, rotation), which SceneBuilder.addLoc turns
// into LocType.getModel(modelKind, variant) calls (see variants). Each goes to
// <outdir>/<locId>-<modelKind>-<variant>.glb, variant 0..3 is the rotation and 4..7 the mirrored
// rotation. <outdir>/index.json is rewritten as the lookup table app/utils/locModels.ts uses:
//   { "879": { "name": "Fountain", "size": [2, 2], "adjustToTerrain": false,
//              "models": { "10_0": "879-10-0.glb", "10_1": "879-10-1.glb" } }, ... }
// size is LocType.sizeX/sizeZ in tiles, needed to centre centrepieces on their tiles, and
// adjustToTerrain means the client bends the model to the slope of its tile when it is placed.
// Wall decorations (kinds 4-8) and ground decorations (22) aren't exported yet.
// Pass every loc that should be in the index; the index only lists the locs of this run.
//
// With "terrain" it exports the ground of map squares instead, see exportTerrain.
//
// usage: ModelExport <cachedir> <outdir> <locId>...   (compile against the client's classes)
//        ModelExport <cachedir> <outdir> terrain <mx_mz>...
//        ModelExport <cachedir> <outdir> player [<gender> <12 appearance slots> <5 colours>]
public class ModelExport {
    public static void main(String[] a) throws Exception {
        String dir = a[0];
        String outDir = a[1];
        RandomAccessFile dat = new RandomAccessFile(dir + "/main_file_cache.dat", "r");
        FileStore archives = new FileStore(500000, dat, new RandomAccessFile(dir + "/main_file_cache.idx0", "r"), 1);
        FileStore models = new FileStore(500000, dat, new RandomAccessFile(dir + "/main_file_cache.idx1", "r"), 2);

        // Game.setHighmem: in lowmem textures are 64x64 and getTexels lays them out as 4 shades of
        // 4096 texels, which texturePng would read as one 128x128 image
        Draw3D.lowmem = false;
        Scene.lowmem = false;
        SceneBuilder.lowmem = false;
        LocType.lowmem = false;

        LocType.unpack(new FileArchive(archives.read(2)));
        Draw3D.unpackTextures(new FileArchive(archives.read(6)));
        Draw3D.setBrightness(0.8);
        Draw3D.initPool(20);

        if (a.length > 2 && a[2].equals("terrain")) {
            FileStore maps = new FileStore(500000, dat, new RandomAccessFile(dir + "/main_file_cache.idx4", "r"), 5);
            exportTerrain(archives, maps, outDir, Arrays.asList(a).subList(3, a.length));
            return;
        }
        if (a.length > 2 && a[2].equals("player")) {
            exportPlayer(archives, models, outDir, Arrays.asList(a).subList(3, a.length));
            return;
        }

        // Model.tryGet only needs the header of each model a loc uses
        java.lang.reflect.Field headers = Model.class.getDeclaredField("headers");
        headers.setAccessible(true);
        headers.set(null, java.lang.reflect.Array.newInstance(headers.getType().getComponentType(), 65535));

        FileStore maps = new FileStore(500000, dat, new RandomAccessFile(dir + "/main_file_cache.idx4", "r"), 5);
        HashMap<Integer, TreeSet<Integer>> placements = placements(archives, maps);

        StringBuilder index = new StringBuilder();
        for (int i = 2; i < a.length; i++) {
            int locId = Integer.parseInt(a[i]);
            LocType loc = LocType.get(locId);
            if (loc.modelIDs == null) {
                System.out.println("loc " + locId + " (" + loc.name + ") has no models, skipped");
                continue;
            }
            for (int id : loc.modelIDs) {
                Model.unpack(new GZIPInputStream(new ByteArrayInputStream(models.read(id & 0xffff))).readAllBytes(), id & 0xffff);
            }

            TreeSet<Integer> variants = new TreeSet<>();
            for (int placement : placements.getOrDefault(locId, new TreeSet<>())) variants.addAll(variants(placement >> 2, placement & 3));
            StringJoiner files = new StringJoiner(", ");
            for (int variant : variants) {
                int kind = variant >> 3, rotation = variant & 7;
                Model m = loc.getModel(kind, rotation, 0, 0, 0, 0, -1);
                if (m == null) continue;
                String file = locId + "-" + kind + "-" + rotation + ".glb";
                System.out.println("loc " + locId + " (" + loc.name + ") kind " + kind + " variant " + rotation + ": " + m.faceCount + " faces -> " + file);
                exportModel(m, outDir + "/" + file, null, outDir);
                files.add("\"" + kind + "_" + rotation + "\": \"" + file + "\"");
            }
            if (files.length() == 0) {
                System.out.println("loc " + locId + " (" + loc.name + ") isn't placed as a wall, roof or centrepiece, skipped");
                continue;
            }

            String name = loc.name == null ? "" : loc.name.replace("\\", "\\\\").replace("\"", "\\\"");
            sep(index).append("\n  \"").append(locId).append("\": { \"name\": \"").append(name)
                .append("\", \"size\": [").append(loc.sizeX).append(", ").append(loc.sizeZ)
                .append("], \"adjustToTerrain\": ").append(loc.adjustToTerrain)
                .append(", \"models\": { ").append(files).append(" } }");
        }
        try (Writer out = new OutputStreamWriter(new FileOutputStream(outDir + "/index.json"), StandardCharsets.UTF_8)) {
            out.write("{" + index + "\n}\n");
        }
    }

    /**
     * The LocType.getModel(modelKind, variant) calls SceneBuilder.addLoc makes for a placement, as
     * modelKind << 3 | variant: centrepieces (10, and 11 turned 45 degrees when drawn) use the kind 10
     * model, an L-shaped wall (2) a mirrored model and the next rotation, walls (0, 1, 3), diagonal
     * walls (9) and roofs (12-21) their own kind. Decorations aren't supported yet.
     */
    static List<Integer> variants(int kind, int rotation) {
        if (kind == 10 || kind == 11) return List.of(10 << 3 | rotation);
        if (kind == 2) return List.of(2 << 3 | (4 + rotation), 2 << 3 | ((rotation + 1) & 3));
        if (kind <= 3 || kind == 9 || (kind >= 12 && kind <= 21)) return List.of(kind << 3 | rotation);
        return List.of();
    }

    /** Every loc's placements in all map squares (SceneBuilder.readLocs), as locId -> kind << 2 | rotation. */
    static HashMap<Integer, TreeSet<Integer>> placements(FileStore archives, FileStore maps) throws IOException {
        HashMap<Integer, TreeSet<Integer>> placements = new HashMap<>();
        Buffer index = new Buffer(new FileArchive(archives.read(5)).read("map_index"));
        for (int i = 0; i < index.data.length / 7; i++) {
            index.readU16(); // square
            index.readU16(); // land file
            int locFile = index.readU16();
            index.readU8();
            byte[] gz = maps.read(locFile);
            if (gz == null) continue;
            Buffer buf = new Buffer(new GZIPInputStream(new ByteArrayInputStream(gz)).readAllBytes());
            int locId = -1;
            for (int deltaId; (deltaId = buf.readUSmart()) != 0; ) {
                locId += deltaId;
                while (buf.readUSmart() != 0) {
                    int info = buf.readU8();
                    placements.computeIfAbsent(locId, k -> new TreeSet<>()).add(info);
                }
            }
        }
        return placements;
    }

    /**
     * Writes a lit model as a .glb. With labels (Model.vertexLabel, which lighting clears), every vertex
     * also gets its label as the _LABEL attribute: the vertex groups SeqTransform frames move, so
     * animations can be applied later. With a textureDir the textures are written once to
     * <textureDir>/textures/<id>.png and referenced, otherwise they are embedded.
     */
    static void exportModel(Model m, String path, int[] labels, String textureDir) throws IOException {
        // one primitive per material: -1 = vertex colours only, otherwise a texture id
        TreeMap<Integer, Prim> prims = new TreeMap<>();
        for (int f = 0; f < m.faceCount; f++) {
            int type = m.faceInfo == null ? 0 : m.faceInfo[f] & 3;
            float alpha = m.faceAlpha == null ? 1f : (256 - (m.faceAlpha[f] & 0xff)) / 256f;
            int[] v = {m.faceVertexA[f], m.faceVertexB[f], m.faceVertexC[f]};

            if (type < 2) {
                Prim p = prims.computeIfAbsent(-1, k -> new Prim());
                int[] colors = type == 0 ? new int[]{m.faceColorA[f], m.faceColorB[f], m.faceColorC[f]} : new int[]{m.faceColorA[f], m.faceColorA[f], m.faceColorA[f]};
                for (int i = 0; i < 3; i++) {
                    p.vertex(m, v[i]);
                    if (labels != null) p.label(labels[v[i]]);
                    int rgb = Draw3D.palette[colors[i]];
                    p.color(((rgb >> 16) & 0xff) / 255f, ((rgb >> 8) & 0xff) / 255f, (rgb & 0xff) / 255f, alpha);
                }
                if (alpha < 1f) p.blend = true;
            } else {
                int texture = m.faceColor[f];
                Prim p = prims.computeIfAbsent(texture, k -> new Prim());
                int t = m.faceInfo[f] >> 2;
                float[][] uv = uvs(m, m.texturedVertexA[t], m.texturedVertexB[t], m.texturedVertexC[t], v);
                int[] shades = type == 2 ? new int[]{m.faceColorA[f], m.faceColorB[f], m.faceColorC[f]} : new int[]{m.faceColorA[f], m.faceColorA[f], m.faceColorA[f]};
                for (int i = 0; i < 3; i++) {
                    p.vertex(m, v[i]);
                    if (labels != null) p.label(labels[v[i]]);
                    float s = shade(shades[i]);
                    p.color(s, s, s, alpha);
                    p.uv(uv[i][0], uv[i][1]);
                }
                if (alpha < 1f) p.blend = true;
            }
        }

        writeGlb(prims, path, textureDir);
        for (Map.Entry<Integer, Prim> e : prims.entrySet()) {
            System.out.println("  " + (e.getKey() == -1 ? "colours" : "texture " + e.getKey()) + ": " + e.getValue().count + " faces" + (e.getValue().blend ? " (transparent)" : ""));
        }
    }

    /** RuneSource's default look (PlayerAttributes): male, kits 18/26/36/0/33/42/10, colours 7/8/9/5/0. */
    static final String[] DEFAULT_PLAYER = {"0", "0", "0", "0", "0", "274", "0", "282", "292", "256", "289", "298", "266", "7", "8", "9", "5", "0"};

    /**
     * Exports a player's look to <outdir>/<gender>_<slots>_<colours>.glb (e.g. 0_0-0-0-0-274-0-282-292-256-289-298-266_7-8-9-5-0.glb),
     * the name app/utils/playerModels.ts builds from the same values. The arguments are what the
     * appearance block of packet 81 carries (PlayerEntity.read): the gender, 12 slots
     * (0 = empty, 256 + an identikit id, 512 + an obj id for worn equipment) and 5 colour indices
     * into Game.designPartColor. No arguments exports DEFAULT_PLAYER.
     * The model is built like PlayerEntity.getSequencedModel without a sequence: the kit and worn obj
     * models merged into one (which joins the vertices they share), recoloured, then lit, so it is the
     * standing base pose with the client's colours. The vertex labels are kept for animations.
     */
    static void exportPlayer(FileStore archives, FileStore models, String outDir, List<String> args) throws Exception {
        String[] v = args.isEmpty() ? DEFAULT_PLAYER : args.toArray(new String[0]);
        if (v.length != 18) throw new IllegalArgumentException("player needs <gender> <12 appearance slots> <5 colours>");
        int gender = Integer.parseInt(v[0]);
        int[] appearances = new int[12], colors = new int[5];
        for (int i = 0; i < 12; i++) appearances[i] = Integer.parseInt(v[1 + i]);
        for (int i = 0; i < 5; i++) colors[i] = Integer.parseInt(v[13 + i]);

        FileArchive config = new FileArchive(archives.read(2));
        IdkType.unpack(config);
        ObjType.unpack(config);

        // Model.tryGet needs the header of every model the kits and objs use; worn obj models are
        // picked per gender inside ObjType, so simply load them all
        java.lang.reflect.Field headers = Model.class.getDeclaredField("headers");
        headers.setAccessible(true);
        headers.set(null, java.lang.reflect.Array.newInstance(headers.getType().getComponentType(), 65535));
        for (int id = 0; id < 65535; id++) {
            byte[] gz = models.read(id);
            if (gz != null) Model.unpack(new GZIPInputStream(new ByteArrayInputStream(gz)).readAllBytes(), id);
        }

        Model[] parts = new Model[12];
        int count = 0;
        for (int value : appearances) {
            Model part = null;
            if (value >= 256 && value < 512) part = IdkType.instances[value - 256].getModel();
            if (value >= 512) part = ObjType.get(value - 512).getWornModel(gender);
            if (part != null) parts[count++] = part;
        }
        Model m = new Model(count, parts);
        for (int part = 0; part < 5; part++) {
            if (colors[part] != 0) {
                m.recolor(Game.designPartColor[part][0], Game.designPartColor[part][colors[part]]);
                if (part == 1) m.recolor(Game.designHairColor[0], Game.designHairColor[colors[part]]);
            }
        }
        int[] labels = m.vertexLabel.clone();
        m.calculateNormals(64, 850, -30, -50, -30, true);

        StringJoiner slots = new StringJoiner("-"), shades = new StringJoiner("-");
        for (int value : appearances) slots.add(String.valueOf(value));
        for (int color : colors) shades.add(String.valueOf(color));
        String path = outDir + "/" + gender + "_" + slots + "_" + shades + ".glb";
        System.out.println("player: " + count + " parts, " + m.vertexCount + " vertices, " + m.faceCount + " faces -> " + path);
        exportModel(m, path, labels, null);
    }

    /** Where a map square sits in the 104x104 scene, so the 8 squares around it fit in too. */
    static final int TERRAIN_OFFSET = 20;

    /**
     * Exports the ground (underlays and overlays) of each map square to <outdir>/<mx>_<mz>_<level>.glb.
     * The tiles are built by the client itself like Game.buildSceneStandard: the land files of the
     * square and its 8 neighbours are read into a SceneBuilder (so the colour blending and heights at
     * the edges match the game), then buildLandscapeLighting and buildTiles run per level and the
     * SceneTileUnderlay/SceneTileOverlay triangles of the square's 64x64 tiles are exported.
     * Locs are not added, so there are no loc shadows on the ground and bridges stay on their own level.
     * The model's origin is the square's south-west corner: tile (x, z) covers x..x+1 and -z-1..-z.
     * Levels without tiles are skipped, level 0 is always written.
     * <outdir>/<mx>_<mz>.json lists the written levels, the heightmap the client places locs and
     * the camera with (SceneBuilder.levelHeightmap), in client units (negative is up), per level
     * 65x65 tile corners at index z * 65 + x, and the tile flags (Game.levelTileFlags: 2 = bridge,
     * 4 = roof, 8 = drawn with level 0) per level 64x64 tiles at index z * 64 + x:
     *   { "levels": [0, 1], "heights": [[...4225], [...], [...], [...]], "flags": [[...4096], ...] }
     */
    static void exportTerrain(FileStore archives, FileStore maps, String outDir, List<String> squares) throws Exception {
        FloType.unpack(new FileArchive(archives.read(2)));

        HashMap<Integer, Integer> landFiles = new HashMap<>();
        Buffer in = new Buffer(new FileArchive(archives.read(5)).read("map_index"));
        for (int i = 0; i < in.data.length / 7; i++) {
            int square = in.readU16();
            landFiles.put(square, in.readU16());
            in.readU16(); // loc file
            in.readU8();
        }

        java.lang.reflect.Method lighting = SceneBuilder.class.getDeclaredMethod("buildLandscapeLighting", int.class);
        java.lang.reflect.Method tiles = SceneBuilder.class.getDeclaredMethod("buildTiles", Scene.class, int.class);
        lighting.setAccessible(true);
        tiles.setAccessible(true);

        for (String name : squares) {
            int mx = Integer.parseInt(name.split("_")[0]), mz = Integer.parseInt(name.split("_")[1]);
            int baseX = mx * 64 - TERRAIN_OFFSET, baseZ = mz * 64 - TERRAIN_OFFSET;
            int[][][] heights = new int[4][105][105];
            SceneBuilder builder = new SceneBuilder(new byte[4][104][104], 104, 104, heights);
            CollisionMap[] collision = new CollisionMap[4];
            for (int l = 0; l < 4; l++) collision[l] = new CollisionMap(104, 104);
            Scene scene = new Scene(104, 104, heights, 4);

            ArrayList<int[]> missing = new ArrayList<>();
            for (int dx = -1; dx <= 1; dx++) {
                for (int dz = -1; dz <= 1; dz++) {
                    int offsetX = (mx + dx) * 64 - baseX, offsetZ = (mz + dz) * 64 - baseZ;
                    Integer file = landFiles.get(((mx + dx) << 8) | (mz + dz));
                    byte[] gz = file == null ? null : maps.read(file);
                    if (gz == null) {
                        if (dx == 0 && dz == 0) throw new IOException("map square " + name + " has no land file in the cache");
                        missing.add(new int[]{offsetX, offsetZ});
                        continue;
                    }
                    builder.readTiles(new GZIPInputStream(new ByteArrayInputStream(gz)).readAllBytes(), offsetZ, offsetX, baseX, baseZ, collision);
                }
            }
            for (int[] o : missing) builder.stitchHeightmap(o[0], o[1], 64, 64);

            StringJoiner levels = new StringJoiner(", "), levelHeights = new StringJoiner(",\n  "), levelFlags = new StringJoiner(",\n  ");
            for (int level = 0; level < 4; level++) {
                StringJoiner h = new StringJoiner(",");
                for (int z = TERRAIN_OFFSET; z <= TERRAIN_OFFSET + 64; z++) {
                    for (int x = TERRAIN_OFFSET; x <= TERRAIN_OFFSET + 64; x++) h.add(String.valueOf(heights[level][x][z]));
                }
                levelHeights.add("[" + h + "]");
                StringJoiner f = new StringJoiner(",");
                for (int z = TERRAIN_OFFSET; z < TERRAIN_OFFSET + 64; z++) {
                    for (int x = TERRAIN_OFFSET; x < TERRAIN_OFFSET + 64; x++) f.add(String.valueOf(builder.levelTileFlags[level][x][z]));
                }
                levelFlags.add("[" + f + "]");

                lighting.invoke(builder, level);
                tiles.invoke(builder, scene, level);

                TreeMap<Integer, Prim> prims = new TreeMap<>();
                for (int x = TERRAIN_OFFSET; x < TERRAIN_OFFSET + 64; x++) {
                    for (int z = TERRAIN_OFFSET; z < TERRAIN_OFFSET + 64; z++) {
                        SceneTile tile = scene.levelTiles[level][x][z];
                        if (tile == null) continue;
                        if (tile.underlay != null) addUnderlay(prims, tile.underlay, heights[level], x, z);
                        if (tile.overlay != null) addOverlay(prims, tile.overlay);
                    }
                }
                if (level > 0 && prims.isEmpty()) continue;
                levels.add(String.valueOf(level));

                String path = outDir + "/" + name + "_" + level + ".glb";
                writeGlb(prims, path, null);
                int faces = 0;
                for (Prim p : prims.values()) faces += p.count;
                System.out.println("map square " + name + " level " + level + ": " + faces + " faces -> " + path);
            }
            try (Writer out = new OutputStreamWriter(new FileOutputStream(outDir + "/" + name + ".json"), StandardCharsets.UTF_8)) {
                out.write("{ \"levels\": [" + levels + "], \"heights\": [\n  " + levelHeights + "\n], \"flags\": [\n  " + levelFlags + "\n] }\n");
            }
        }
    }

    /**
     * Scene.drawTileUnderlay: triangles NE-NW-SE and SW-SE-NW. A textured underlay (a full overlay
     * tile) maps the texture from SW, or from NE for the first triangle when the tile isn't flat.
     */
    static void addUnderlay(TreeMap<Integer, Prim> prims, SceneTileUnderlay u, int[][] heights, int x, int z) {
        // corners SW, SE, NE, NW
        int[] vx = {x * 128, x * 128 + 128, x * 128 + 128, x * 128};
        int[] vz = {z * 128, z * 128, z * 128 + 128, z * 128 + 128};
        int[] vy = {heights[x][z], heights[x + 1][z], heights[x + 1][z + 1], heights[x][z + 1]};
        int[] colors = {u.southwestColor, u.southeastColor, u.northeastColor, u.northwestColor};
        int[] texture = u.flat ? new int[]{0, 1, 3} : new int[]{2, 3, 1};
        addTerrainTriangle(prims, vx, vy, vz, new int[]{2, 3, 1}, colors[2], colors[3], colors[1], u.textureID, texture);
        addTerrainTriangle(prims, vx, vy, vz, new int[]{0, 1, 3}, colors[0], colors[1], colors[3], u.textureID, new int[]{0, 1, 3});
    }

    /** Scene.drawTileOverlay: a flat overlay maps textures from its corners SW, SE, NW, a sloped one per triangle. */
    static void addOverlay(TreeMap<Integer, Prim> prims, SceneTileOverlay o) {
        for (int t = 0; t < o.triangleVertexA.length; t++) {
            int[] v = {o.triangleVertexA[t], o.triangleVertexB[t], o.triangleVertexC[t]};
            int texture = o.triangleTextureIDs == null ? -1 : o.triangleTextureIDs[t];
            addTerrainTriangle(prims, o.vertexX, o.vertexY, o.vertexZ, v, o.triangleColorA[t], o.triangleColorB[t], o.triangleColorC[t], texture, o.flat ? new int[]{0, 1, 3} : v);
        }
    }

    /**
     * One ground triangle in scene units. Without a texture the colours are HSL palette indices and
     * 12345678 means invisible; with one they are shade levels like on textured model faces.
     */
    static void addTerrainTriangle(TreeMap<Integer, Prim> prims, int[] vx, int[] vy, int[] vz, int[] v, int colorA, int colorB, int colorC, int texture, int[] pmn) {
        if (texture == -1 && colorA == 12345678) return;
        Prim p = prims.computeIfAbsent(texture, k -> new Prim());
        int[] colors = {colorA, colorB, colorC};
        float[][] uv = texture == -1 ? null : uvs(vx, vy, vz, pmn[0], pmn[1], pmn[2], v);
        for (int i = 0; i < 3; i++) {
            p.vertex(vx[v[i]] - TERRAIN_OFFSET * 128, vy[v[i]], vz[v[i]] - TERRAIN_OFFSET * 128);
            if (texture == -1) {
                int rgb = Draw3D.palette[colors[i]];
                p.color(((rgb >> 16) & 0xff) / 255f, ((rgb >> 8) & 0xff) / 255f, (rgb & 0xff) / 255f, 1f);
            } else {
                float s = shade(colors[i]);
                p.color(s, s, s, 1f);
                p.uv(uv[i][0], uv[i][1]);
            }
        }
    }

    /**
     * Brightness of a textured vertex. The client keeps 4 darkened copies of each texture
     * (1, 7/8, 3/4, 5/8) and shifts texels right by 0 or 1, picked by the shade value 0..127.
     */
    static float shade(int s) {
        s = Math.max(0, Math.min(127, s));
        float[] tile = {1f, 7f / 8, 3f / 4, 5f / 8};
        return tile[(s >> 4) & 3] / (1 << (s >> 6));
    }

    /**
     * UVs for the three corners of a textured face. P is the texture origin, M - P spans u = 0..1
     * and N - P spans v = 0..1; each corner is projected onto that plane along its normal.
     */
    static float[][] uvs(Model m, int p, int mm, int n, int[] corners) {
        return uvs(m.vertexX, m.vertexY, m.vertexZ, p, mm, n, corners);
    }

    static float[][] uvs(int[] vx, int[] vy, int[] vz, int p, int mm, int n, int[] corners) {
        double px = vx[p], py = vy[p], pz = vz[p];
        double[] u = {vx[mm] - px, vy[mm] - py, vz[mm] - pz};
        double[] w = {vx[n] - px, vy[n] - py, vz[n] - pz};
        double[] normal = cross(u, w);
        double[] uPerp = cross(w, normal); // dot(x, uPerp) / dot(u, uPerp) gives the u component
        double[] vPerp = cross(u, normal);
        double uDen = dot(u, uPerp), vDen = dot(w, vPerp);
        float[][] out = new float[3][2];
        for (int i = 0; i < 3; i++) {
            double[] d = {vx[corners[i]] - px, vy[corners[i]] - py, vz[corners[i]] - pz};
            out[i][0] = (float) (dot(d, uPerp) / uDen);
            out[i][1] = (float) (dot(d, vPerp) / vDen);
        }
        return out;
    }

    static double[] cross(double[] a, double[] b) {
        return new double[]{a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
    }

    static double dot(double[] a, double[] b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    static class Prim {
        final ArrayList<Float> positions = new ArrayList<>(), colors = new ArrayList<>(), uvs = new ArrayList<>(), labels = new ArrayList<>();
        int count;
        boolean blend;

        void vertex(Model m, int v) {
            vertex(m.vertexX[v], m.vertexY[v], m.vertexZ[v]);
        }

        void vertex(int x, int y, int z) {
            positions.add(x / 128f);
            positions.add(-y / 128f);
            positions.add(-z / 128f);
            if (positions.size() % 9 == 0) count++;
        }

        void color(float r, float g, float b, float alpha) {
            colors.add(r);
            colors.add(g);
            colors.add(b);
            colors.add(alpha);
        }

        void uv(float u, float v) {
            uvs.add(u);
            uvs.add(v);
        }

        void label(int label) {
            labels.add((float) label);
        }
    }

    /** 128x128 texture with the client's brightness applied; rgb 0 is transparent like in Draw3D. */
    static byte[] texturePng(int id) throws IOException {
        int[] texels = Draw3D.getTexels(id);
        boolean translucent = Draw3D.textureTranslucent[id];
        BufferedImage im = new BufferedImage(128, 128, BufferedImage.TYPE_INT_ARGB);
        for (int i = 0; i < 16384; i++) {
            int rgb = texels[i];
            im.setRGB(i & 127, i >> 7, translucent && rgb == 0 ? 0 : 0xff000000 | rgb);
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(im, "png", out);
        return out.toByteArray();
    }

    /** textures already written to a textureDir in this run */
    static final HashSet<String> writtenTextures = new HashSet<>();

    /** With a textureDir the glb references <textureDir>/textures/<id>.png (relative to the glb, which must be in textureDir). */
    static void writeGlb(TreeMap<Integer, Prim> prims, String path, String textureDir) throws IOException {
        ByteArrayOutputStream bin = new ByteArrayOutputStream();
        StringBuilder views = new StringBuilder(), accessors = new StringBuilder(), primitives = new StringBuilder();
        StringBuilder materials = new StringBuilder(), textures = new StringBuilder(), images = new StringBuilder();
        int[] counts = new int[3]; // views, accessors, images

        for (Map.Entry<Integer, Prim> e : prims.entrySet()) {
            Prim p = e.getValue();
            int vertices = p.positions.size() / 3;

            float[] min = {Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE}, max = {-Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};
            for (int i = 0; i < p.positions.size(); i++) {
                min[i % 3] = Math.min(min[i % 3], p.positions.get(i));
                max[i % 3] = Math.max(max[i % 3], p.positions.get(i));
            }
            int pos = accessor(bin, views, accessors, counts, p.positions, vertices, "VEC3",
                ",\"min\":[" + min[0] + "," + min[1] + "," + min[2] + "],\"max\":[" + max[0] + "," + max[1] + "," + max[2] + "]");
            int col = accessor(bin, views, accessors, counts, p.colors, vertices, "VEC4", "");
            String attributes = "\"POSITION\":" + pos + ",\"COLOR_0\":" + col;
            if (!p.labels.isEmpty()) attributes += ",\"_LABEL\":" + accessor(bin, views, accessors, counts, p.labels, vertices, "SCALAR", "");

            int material = materials.length() == 0 ? 0 : materials.toString().split("\\{\"name\"").length - 1;
            String alphaMode = p.blend ? "\"BLEND\"" : "\"OPAQUE\"";
            String base = "";
            if (e.getKey() >= 0) {
                int uv = accessor(bin, views, accessors, counts, p.uvs, vertices, "VEC2", "");
                attributes += ",\"TEXCOORD_0\":" + uv;
                byte[] png = texturePng(e.getKey());
                if (textureDir == null) {
                    int view = view(bin, views, counts, png);
                    sep(images).append("{\"bufferView\":").append(view).append(",\"mimeType\":\"image/png\"}");
                } else {
                    String uri = "textures/" + e.getKey() + ".png";
                    if (writtenTextures.add(textureDir + "/" + uri)) {
                        new File(textureDir, "textures").mkdirs();
                        try (FileOutputStream out = new FileOutputStream(new File(textureDir, uri))) {
                            out.write(png);
                        }
                    }
                    sep(images).append("{\"uri\":\"").append(uri).append("\",\"mimeType\":\"image/png\"}");
                }
                int image = counts[2]++;
                sep(textures).append("{\"sampler\":0,\"source\":").append(image).append('}');
                base = ",\"baseColorTexture\":{\"index\":" + image + "}";
                if (!p.blend && Draw3D.textureTranslucent[e.getKey()]) alphaMode = "\"MASK\",\"alphaCutoff\":0.5";
            }
            sep(materials).append("{\"name\":\"").append(e.getKey() < 0 ? "colours" : "texture " + e.getKey())
                .append("\",\"pbrMetallicRoughness\":{\"baseColorFactor\":[1,1,1,1],\"metallicFactor\":0,\"roughnessFactor\":1")
                .append(base).append("},\"alphaMode\":").append(alphaMode)
                .append(",\"doubleSided\":true,\"extensions\":{\"KHR_materials_unlit\":{}}}");
            sep(primitives).append("{\"attributes\":{").append(attributes).append("},\"material\":").append(material).append('}');
        }

        String json = "{\"asset\":{\"version\":\"2.0\"},"
            + "\"extensionsUsed\":[\"KHR_materials_unlit\"],"
            + "\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0,\"name\":\"model\"}],"
            + "\"meshes\":[{\"primitives\":[" + primitives + "]}],"
            + "\"materials\":[" + materials + "],"
            + (textures.length() > 0 ? "\"textures\":[" + textures + "],\"images\":[" + images + "],"
                // NEAREST filtering keeps the texels sharp like the software renderer; REPEAT like the & masks
                + "\"samplers\":[{\"magFilter\":9728,\"minFilter\":9728,\"wrapS\":10497,\"wrapT\":10497}]," : "")
            + "\"accessors\":[" + accessors + "],\"bufferViews\":[" + views + "],"
            + "\"buffers\":[{\"byteLength\":" + bin.size() + "}]}";

        byte[] jsonBytes = pad(json.getBytes(StandardCharsets.UTF_8), (byte) ' ');
        byte[] binBytes = pad(bin.toByteArray(), (byte) 0);
        ByteBuffer glb = ByteBuffer.allocate(12 + 8 + jsonBytes.length + 8 + binBytes.length).order(ByteOrder.LITTLE_ENDIAN);
        glb.putInt(0x46546C67).putInt(2).putInt(glb.capacity());
        glb.putInt(jsonBytes.length).putInt(0x4E4F534A).put(jsonBytes);
        glb.putInt(binBytes.length).putInt(0x004E4942).put(binBytes);
        try (FileOutputStream out = new FileOutputStream(path)) {
            out.write(glb.array());
        }
    }

    static int accessor(ByteArrayOutputStream bin, StringBuilder views, StringBuilder accessors, int[] counts, List<Float> data, int count, String type, String extra) {
        ByteBuffer b = ByteBuffer.allocate(data.size() * 4).order(ByteOrder.LITTLE_ENDIAN);
        for (float f : data) b.putFloat(f);
        int view = view(bin, views, counts, b.array());
        sep(accessors).append("{\"bufferView\":").append(view).append(",\"componentType\":5126,\"count\":").append(count)
            .append(",\"type\":\"").append(type).append('"').append(extra).append('}');
        return counts[1]++;
    }

    static int view(ByteArrayOutputStream bin, StringBuilder views, int[] counts, byte[] data) {
        while (bin.size() % 4 != 0) bin.write(0);
        sep(views).append("{\"buffer\":0,\"byteOffset\":").append(bin.size()).append(",\"byteLength\":").append(data.length).append('}');
        bin.write(data, 0, data.length);
        return counts[0]++;
    }

    static StringBuilder sep(StringBuilder sb) {
        if (sb.length() > 0) sb.append(',');
        return sb;
    }

    static byte[] pad(byte[] data, byte fill) {
        byte[] out = Arrays.copyOf(data, (data.length + 3) & ~3);
        Arrays.fill(out, data.length, out.length, fill);
        return out;
    }
}
