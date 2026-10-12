import java.awt.image.BufferedImage;
import java.io.*;
import javax.imageio.ImageIO;

// Prints an interface tree from the cache (positions, text, fonts, colours, options) and writes
// its sprites as PNGs; app/utils/interfaces.ts is written from this output.
// usage: InterfaceExport <cachedir> <interfaceId> <outdir>
// Sprites are written as <id>_image.png at full size with the crop offsets applied.
public class InterfaceExport {
    static BitmapFont[] fonts;
    static String[] fontNames = {"p11_full", "p12_full", "b12_full", "q8_full"};
    static String out;

    public static void main(String[] a) throws Exception {
        String dir = a[0];
        out = a[2];
        FileStore store = new FileStore(500000, new RandomAccessFile(dir + "/main_file_cache.dat", "r"), new RandomAccessFile(dir + "/main_file_cache.idx0", "r"), 1);
        FileArchive title = new FileArchive(store.read(1));
        FileArchive iface = new FileArchive(store.read(3));
        FileArchive media = new FileArchive(store.read(4));
        fonts = new BitmapFont[]{new BitmapFont(title, "p11_full", false), new BitmapFont(title, "p12_full", false), new BitmapFont(title, "b12_full", false), new BitmapFont(title, "q8_full", true)};
        IfType.unpack(iface, fonts, media);
        dump(IfType.instances[Integer.parseInt(a[1])], 0, 0, "");
    }

    static void dump(IfType t, int ax, int ay, String indent) throws IOException {
        String font = "-";
        for (int i = 0; i < fonts.length; i++) if (t.font == fonts[i]) font = fontNames[i];
        System.out.println(indent + "id=" + t.id + " type=" + t.type + " at=" + ax + "," + ay + " size=" + t.width + "x" + t.height
            + " optionType=" + t.optionType + " option=" + t.option + " contentType=" + t.contentType
            + " text=" + (t.text == null ? null : "\"" + t.text.replace("\\n", "\\\\n") + "\"") + " activeText=" + t.activeText
            + " font=" + font + " center=" + t.center + " shadow=" + t.shadow
            + String.format(" color=%06x hover=%06x active=%06x activeHover=%06x", t.color, t.hoverColor, t.activeColor, t.activeHoverColor)
            + " fill=" + t.fill + " delegateHover=" + t.delegateHover + " hide=" + t.hide
            + " image=" + png(t.image, t.id + "_image") + " activeImage=" + png(t.activeImage, t.id + "_activeImage")
            + " scripts=" + (t.scripts != null));
        if (t.childID != null) {
            for (int i = 0; i < t.childID.length; i++) {
                dump(IfType.instances[t.childID[i]], ax + t.childX[i], ay + t.childY[i], indent + "  ");
            }
        }
    }

    static String png(Image24 img, String name) throws IOException {
        if (img == null) return null;
        BufferedImage im = new BufferedImage(img.cropW, img.cropH, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < img.height; y++)
            for (int x = 0; x < img.width; x++) {
                int p = img.pixels[x + y * img.width];
                if (p != 0) im.setRGB(x + img.cropX, y + img.cropY, 0xff000000 | p);
            }
        ImageIO.write(im, "png", new File(out + "/" + name + ".png"));
        return name + ".png (" + img.cropW + "x" + img.cropH + " crop " + img.cropX + "," + img.cropY + ")";
    }
}
