"""深入分析编辑 PDF 的 content stream 顺序和小图片"""
import fitz

edited_path = r"C:\Users\Fan\Downloads\edited (20).pdf"
doc = fitz.open(edited_path)
page = doc[0]

print("=" * 60)
print("Content Stream ORDER Analysis")
print("=" * 60)

# 获取所有 content stream xref 及其顺序
cs_xrefs = page.get_contents()
print(f"Total content streams: {len(cs_xrefs)}")
print(f"Order: {cs_xrefs}")

# 分析每个 stream 的内容类型
for i, xref in enumerate(cs_xrefs):
    stream = doc.xref_stream(xref)
    if stream:
        decoded = stream.decode('latin-1', errors='ignore')
        # 判断内容类型
        has_text = 'BT' in decoded and 'ET' in decoded
        has_rect = 're' in decoded
        has_fill = 'f' in decoded or 'F' in decoded
        has_image = 'Do' in decoded

        content_type = []
        if has_text: content_type.append('TEXT')
        if has_rect: content_type.append('RECT')
        if has_fill: content_type.append('FILL')
        if has_image: content_type.append('IMAGE')

        print(f"\n[{i}] xref={xref}: {', '.join(content_type) if content_type else 'OTHER'}")
        # 打印前几行
        lines = decoded.split('\n')[:8]
        for line in lines:
            print(f"    {line[:80]}")

# 分析小图片 xref 128-143 的内容
print("\n" + "=" * 60)
print("Small Images Analysis (xref 128-143)")
print("=" * 60)

small_xrefs = [128, 131, 134, 137, 140, 143]
for xref in small_xrefs:
    try:
        pix = fitz.Pixmap(doc, xref)
        print(f"\nxref={xref}:")
        print(f"  Size: {pix.width}x{pix.height}, n={pix.n} (channels)")
        print(f"  Colorspace: {pix.colorspace}")
        # 检查是否是纯色图片
        if pix.width > 0 and pix.height > 0:
            samples = pix.samples
            # 取第一个像素
            first_px = samples[:pix.n]
            print(f"  First pixel: {list(first_px)}")
            # 检查是否所有像素相同
            all_same = True
            for i in range(1, pix.width * pix.height):
                px = samples[i * pix.n:(i + 1) * pix.n]
                if px != first_px:
                    all_same = False
                    break
            print(f"  All pixels same: {all_same}")
    except Exception as e:
        print(f"\nxref={xref}: Error - {e}")

# 检查水印图片 xref=124 的信息
print("\n" + "=" * 60)
print("Watermark Image Analysis (xref=124)")
print("=" * 60)
try:
    pix = fitz.Pixmap(doc, 124)
    print(f"Size: {pix.width}x{pix.height}")
    print(f"Channels: {pix.n}")
    print(f"Alpha: {pix.alpha}")
    # 检查 SMask
    obj_str = doc.xref_object(124)
    print(f"Object: {obj_str[:200]}")
    if '/SMask' in obj_str:
        print("Has SMask (transparency mask)")
except Exception as e:
    print(f"Error: {e}")

# 原始水印图片 xref=53 对比
print("\n" + "=" * 60)
print("Original Watermark Image Analysis (xref=53 from original)")
print("=" * 60)
original_path = r"C:\Users\Fan\Downloads\1059098842_qq_com_signed_signed (17).pdf"
doc_orig = fitz.open(original_path)
page_orig = doc_orig[0]
try:
    pix_orig = fitz.Pixmap(doc_orig, 53)
    print(f"Size: {pix_orig.width}x{pix_orig.height}")
    print(f"Channels: {pix_orig.n}")
    print(f"Alpha: {pix_orig.alpha}")
    obj_str_orig = doc_orig.xref_object(53)
    print(f"Object: {obj_str_orig[:200]}")
    if '/SMask' in obj_str_orig:
        print("Has SMask (transparency mask)")
except Exception as e:
    print(f"Error: {e}")

doc.close()
doc_orig.close()
print("\nAnalysis complete.")