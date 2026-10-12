import java.awt.image.BufferedImage;
import java.io.*;
import javax.imageio.ImageIO;

// Composites the static 765x503 title background (mirrored title.dat + logo) exactly like
// Game.loadTitleBackground(), and exports the titlebox/titlebutton sprites at their crop offsets.
public class TitleImages {
    public static void main(String[] a) throws Exception {
        String dir = a[0], out = a[1];
        FileStore store = new FileStore(500000, new RandomAccessFile(dir + "/main_file_cache.dat", "r"), new RandomAccessFile(dir + "/main_file_cache.idx0", "r"), 1);
        FileArchive title = new FileArchive(store.read(1));

        BufferedImage bg = ImageIO.read(new ByteArrayInputStream(title.read("title.dat")));
        int bw = bg.getWidth(), bh = bg.getHeight();
        int[] dst = new int[765 * 503];
        for (int y = 0; y < bh && y < 503; y++) {
            for (int x = 0; x < bw; x++) {
                int rgb = bg.getRGB(x, y) & 0xffffff;
                if (x < 765) dst[x + y * 765] = rgb;
            }
            for (int x = 0; x < bw; x++) {
                int dx = 382 + x;
                if (dx < 765) dst[dx + y * 765] = bg.getRGB(bw - x - 1, y) & 0xffffff;
            }
        }

        // logo is drawn into imageTitle2 (screen 128,0 509x171) only
        Image24 logo = new Image24(title, "logo", 0);
        int lx = 382 - (logo.width / 2) + logo.cropX, ly = 18 + logo.cropY;
        for (int y = 0; y < logo.height; y++) {
            for (int x = 0; x < logo.width; x++) {
                int p = logo.pixels[x + y * logo.width];
                int sx = lx + x, sy = ly + y;
                if (p != 0 && sx >= 128 && sx < 637 && sy < 171) dst[sx + sy * 765] = p;
            }
        }
        write(dst, 765, 503, out + "/background.png", false);

        write(sprite(new Image8(title, "titlebox", 0)), 360, 200, out + "/titlebox.png", true);
        Image8 b = new Image8(title, "titlebutton", 0);
        write(sprite(b), b.cropW, b.cropH, out + "/titlebutton.png", true);
        System.out.println("titlebox crop: " + new Image8(title, "titlebox", 0).cropW + " button crop: " + b.cropX + "," + b.cropY + " " + b.cropW + "x" + b.cropH);
    }

    static int[] sprite(Image8 img) {
        int[] px = new int[img.cropW * img.cropH];
        for (int y = 0; y < img.height; y++)
            for (int x = 0; x < img.width; x++) {
                int i = img.pixels[x + y * img.width] & 0xff;
                if (i != 0) px[(x + img.cropX) + (y + img.cropY) * img.cropW] = 0xff000000 | img.palette[i];
            }
        return px;
    }

    static void write(int[] px, int w, int h, String path, boolean alpha) throws IOException {
        BufferedImage im = new BufferedImage(w, h, alpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        im.setRGB(0, 0, w, h, px, 0, w);
        ImageIO.write(im, "png", new File(path));
    }
}
