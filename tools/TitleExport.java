import java.io.*;

// Exports exact font metrics/masks and rune masks from the title archive as JSON.
public class TitleExport {
    public static void main(String[] a) throws Exception {
        String dir = a[0];
        RandomAccessFile dat = new RandomAccessFile(dir + "/main_file_cache.dat", "r");
        RandomAccessFile idx = new RandomAccessFile(dir + "/main_file_cache.idx0", "r");
        FileStore store = new FileStore(500000, dat, idx, 1);
        FileArchive title = new FileArchive(store.read(1));
        StringBuilder sb = new StringBuilder("{\"fonts\":{");
        String[] fonts = {"b12_full", "p11_full", "p12_full"};

        for (int f = 0; f < fonts.length; f++) {
            BitmapFont font = new BitmapFont(title, fonts[f], false);
            if (f > 0) sb.append(',');
            sb.append('"').append(fonts[f]).append("\":{\"height\":").append(font.height).append(",\"glyphs\":[");
            for (int c = 0; c < 256; c++) {
                if (c > 0) sb.append(',');
                sb.append('[').append(font.charOffsetX[c]).append(',').append(font.charOffsetY[c]).append(',')
                  .append(font.charMaskWidth[c]).append(',').append(font.charMaskHeight[c]).append(',')
                  .append(font.charAdvance[c]).append(",\"").append(bits(font.charMask[c])).append("\"]");
            }
            sb.append("]}");
        }
        sb.append("},\"runes\":[");
        for (int i = 0; i < 16; i++) {
            Image8 img = new Image8(title, "runes", i);
            if (i > 0) sb.append(',');
            sb.append("{\"cropX\":").append(img.cropX).append(",\"cropY\":").append(img.cropY)
              .append(",\"width\":").append(img.width).append(",\"height\":").append(img.height)
              .append(",\"mask\":\"").append(bits(img.pixels)).append("\"}");
        }
        sb.append("]}");
        System.out.println(sb);
    }

    // one hex nibble per 4 pixels, bit set when the pixel is non-zero
    static String bits(byte[] p) {
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < p.length; i += 4) {
            int n = 0;
            for (int b = 0; b < 4; b++) if (i + b < p.length && p[i + b] != 0) n |= 8 >> b;
            s.append(Integer.toHexString(n));
        }
        return s.toString();
    }
}
