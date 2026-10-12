import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPInputStream;

// Exports the loc placements of every map square (64x64 tiles) as JSON, one file per square:
//   <outdir>/<mx>_<mz>.json = [[locId, x, z, level, kind, rotation], ...]
// x and z are 0..63 within the square, so the world tile is mx * 64 + x, mz * 64 + z.
// The loc files are decoded like SceneBuilder.readLocs; the square -> file mapping comes from
// versionlist's map_index like OnDemand does.
//
// usage: MapExport <cachedir> <outdir> [mx_mz ...]   (no squares = all 587, about 22 MB)
public class MapExport {
    public static void main(String[] a) throws Exception {
        String dir = a[0];
        String outDir = a[1];
        java.util.Set<String> only = new java.util.HashSet<>(java.util.Arrays.asList(a).subList(2, a.length));
        RandomAccessFile dat = new RandomAccessFile(dir + "/main_file_cache.dat", "r");
        FileStore archives = new FileStore(500000, dat, new RandomAccessFile(dir + "/main_file_cache.idx0", "r"), 1);
        FileStore maps = new FileStore(500000, dat, new RandomAccessFile(dir + "/main_file_cache.idx4", "r"), 5);

        byte[] index = new FileArchive(archives.read(5)).read("map_index");
        Buffer in = new Buffer(index);
        int squares = 0, locs = 0, missing = 0;

        for (int i = 0; i < index.length / 7; i++) {
            int square = in.readU16();
            in.readU16(); // land file
            int locFile = in.readU16();
            in.readU8(); // prefetched/members flag
            String name = (square >> 8) + "_" + (square & 0xff);
            if (!only.isEmpty() && !only.contains(name)) continue;

            byte[] gz = maps.read(locFile);
            if (gz == null) {
                missing++;
                continue;
            }
            byte[] data = new GZIPInputStream(new ByteArrayInputStream(gz)).readAllBytes();

            StringBuilder json = new StringBuilder("[");
            Buffer buf = new Buffer(data);
            int locID = -1;
            for (int deltaID; (deltaID = buf.readUSmart()) != 0; ) {
                locID += deltaID;
                int locData = 0;
                for (int deltaData; (deltaData = buf.readUSmart()) != 0; ) {
                    locData += deltaData - 1;
                    int info = buf.readU8();
                    if (json.length() > 1) json.append(',');
                    json.append('[').append(locID).append(',').append((locData >> 6) & 0x3f).append(',').append(locData & 0x3f)
                        .append(',').append(locData >> 12).append(',').append(info >> 2).append(',').append(info & 3).append(']');
                    locs++;
                }
            }
            json.append("]\n");

            try (Writer out = new OutputStreamWriter(new FileOutputStream(outDir + "/" + name + ".json"), StandardCharsets.UTF_8)) {
                out.write(json.toString());
            }
            squares++;
        }
        System.out.println(squares + " map squares, " + locs + " locs" + (missing > 0 ? ", " + missing + " loc files not in the cache" : ""));
    }
}
