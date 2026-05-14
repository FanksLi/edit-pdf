"""检查原始 PDF 的整体背景和水印图片"""
import fitz

original_path = r"C:\Users\Fan\Downloads\1059098842_qq_com_signed_signed (17).pdf"
doc = fitz.open(original_path)
page = doc[0]

print("=" * 60)
print("页面整体背景色采样")
print("=" * 60)

# 采样不同区域的背景
areas = [
    ("顶部标题", fitz.Rect(60, 60, 200, 100)),
    ("甲方信息区", fitz.Rect(60, 200, 200, 240)),
    ("乙方信息区", fitz.Rect(60, 310, 200, 350)),
    ("注册地址区", fitz.Rect(60, 275, 200, 295)),
    ("水印区域内", fitz.Rect(250, 350, 350, 400)),
    ("水印区域外", fitz.Rect(60, 560, 200, 600)),
]

for name, rect in areas:
    pix = page.get_pixmap(matrix=fitz.Matrix(1, 1), clip=rect, alpha=False)
    # 采样多个点
    pixels = []
    for y in range(5, pix.height - 5):
        for x in range(5, pix.width - 5):
            idx = (y * pix.width + x) * 3
            pixels.append((pix.samples[idx], pix.samples[idx+1], pix.samples[idx+2]))

    # 计算平均
    avg = (
        sum(p[0] for p in pixels) // len(pixels),
        sum(p[1] for p in pixels) // len(pixels),
        sum(p[2] for p in pixels) // len(pixels),
    )
    print(f"\n{name}:")
    print(f"  avg RGB: {avg}")
    print(f"  is gray: {abs(avg[0]-avg[1])<5 and abs(avg[1]-avg[2])<5}")

# 检查水印图片 xref=53 的实际像素内容
print("\n" + "=" * 60)
print("水印图片 xref=53 分析")
print("=" * 60)

try:
    pix = fitz.Pixmap(doc, 53)
    print(f"Size: {pix.width}x{pix.height}")
    print(f"Channels: {pix.n}")

    # 采样水印图片像素
    samples = []
    for y in range(0, pix.height, 20):
        for x in range(0, pix.width, 20):
            idx = (y * pix.width + x) * pix.n
            if pix.n >= 3:
                samples.append((pix.samples[idx], pix.samples[idx+1], pix.samples[idx+2]))

    avg = (
        sum(s[0] for s in samples) // len(samples),
        sum(s[1] for s in samples) // len(samples),
        sum(s[2] for s in samples) // len(samples),
    )
    print(f"Average color in watermark: {avg}")

    # 检查是否有透明度（SMask）
    obj_str = doc.xref_object(53)
    if "/SMask" in obj_str:
        print("Has SMask (transparency mask)")
        # 获取 SMask 内容
        match = None
        import re
        match = re.search(r'/SMask\s+(\d+)\s+0\s+R', obj_str)
        if match:
            smask_xref = int(match.group(1))
            print(f"SMask xref: {smask_xref}")
            mask_pix = fitz.Pixmap(doc, smask_xref)
            print(f"Mask size: {mask_pix.width}x{mask_pix.height}")
            # 采样 mask
            mask_vals = []
            for y in range(0, mask_pix.height, 20):
                for x in range(0, mask_pix.width, 20):
                    idx = (y * mask_pix.width + x) * mask_pix.n
                    mask_vals.append(mask_pix.samples[idx])
            avg_mask = sum(mask_vals) // len(mask_vals)
            print(f"Average mask value: {avg_mask} (0=transparent, 255=opaque)")

except Exception as e:
    print(f"Error: {e}")

# 检查水印图片 bbox 与"注册地址"的关系
print("\n" + "=" * 60)
print("水印图片与注册地址的位置关系")
print("=" * 60)

watermark_bbox = fitz.Rect(194.1, 317.4, 401.1, 524.4)
register_addr_bbox = fitz.Rect(62.7, 278.2, 314.7, 288.7)

print(f"水印图片: y={watermark_bbox.y0:.1f}-{watermark_bbox.y1:.1f}")
print(f"注册地址: y={register_addr_bbox.y0:.1f}-{register_addr_bbox.y1:.1f}")
print(f"重叠? {watermark_bbox.intersects(register_addr_bbox)}")
print(f"注册地址在水印上方? {register_addr_bbox.y1 < watermark_bbox.y0}")

doc.close()
print("\nDone.")