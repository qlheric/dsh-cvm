"""读取 CSV 文件并输出数据行数（不含表头行）。

环境里装不了任何第三方包，所以不能用 pandas，全部用 Python 标准库
（csv / sys）实现。

用法:
    python script.py <csv文件路径>

行为:
    - 输出数据行数（不含表头）：空文件、只有表头的文件 -> 0
    - 空行会被跳过（与 pandas.read_csv 的默认行为一致）
    - 引号里的逗号与换行由 csv 模块解析，不会被误当成新行
    - 编码：先按 BOM 判定 UTF-8 / UTF-16 / UTF-32；没有 BOM 时先用 NUL 字节
      的分布嗅探无 BOM 的 UTF-16 / UTF-32，再依次尝试 utf-8-sig（兼容带 BOM
      与不带 BOM 的 UTF-8）和 gb18030（兼容中文 Windows / Excel 导出的 CSV）
"""

import csv
import sys

# 没有 BOM 时依次尝试的编码。
_FALLBACK_ENCODINGS = ('utf-8-sig', 'gb18030')

# BOM 探测表。必须按 BOM 长度从长到短匹配：
# UTF-32LE 的 BOM（FF FE 00 00）以 UTF-16LE 的 BOM（FF FE）开头，
# 顺序反了会把 UTF-32LE 误判成 UTF-16LE。
_BOMS = (
    (b'\xff\xfe\x00\x00', 'utf-32'),   # UTF-32LE
    (b'\x00\x00\xfe\xff', 'utf-32'),   # UTF-32BE
    (b'\xff\xfe', 'utf-16'),           # UTF-16LE
    (b'\xfe\xff', 'utf-16'),           # UTF-16BE
    (b'\xef\xbb\xbf', 'utf-8-sig'),    # UTF-8
)


def detect_bom_encoding(path):
    """读取文件头几个字节，按 BOM 返回编码名；没有 BOM 时返回 None。"""
    with open(path, 'rb') as fp:
        head = fp.read(4)
    for bom, encoding in _BOMS:
        if head.startswith(bom):
            return encoding
    return None


# 嗅探无 BOM 宽字符文本时读取的字节数。
_SNIFF_SIZE = 256


def read_head(path, size=_SNIFF_SIZE):
    """读取文件开头最多 size 个字节（二进制），用于编码嗅探。"""
    with open(path, 'rb') as fp:
        return fp.read(size)


def sniff_wide_encoding(head):
    """没有 BOM 时，用 NUL 字节的分布嗅探 UTF-16 / UTF-32 及其端序。

    纯 ASCII 的 UTF-16LE 文本形如 b'n\\x00a\\x00'（NUL 都落在奇数位），
    UTF-32LE 则形如 b'n\\x00\\x00\\x00'（第 1、2、3 字节都是 NUL）。
    普通 UTF-8 / GB18030 文本不含 NUL 字节，这里必然返回 None，
    因此不会改变既有行为。

    返回明确的编码名（utf-16-le / utf-16-be / utf-32-le / utf-32-be）；
    不像宽字符文本时返回 None。
    """
    nuls = [i for i, byte in enumerate(head) if byte == 0]
    if len(nuls) < 2 or len(nuls) * 4 < len(head):
        return None
    mod4 = sorted({i % 4 for i in nuls})
    if mod4 == [1, 2, 3]:
        return 'utf-32-le'
    if mod4 == [0, 1, 2]:
        return 'utf-32-be'
    mod2 = sorted({i % 2 for i in nuls})
    if mod2 == [1]:
        return 'utf-16-le'
    if mod2 == [0]:
        return 'utf-16-be'
    return None


def candidate_encodings(path):
    """列出待尝试的编码（已去重）：BOM 判定结果优先，其次无 BOM 嗅探结果，
    最后是通用回退编码。"""
    detected = detect_bom_encoding(path)
    ordered = []
    if detected:
        ordered.append(detected)
    else:
        # 没有 BOM 时才嗅探：无 BOM 的 UTF-16/32 若落到 gb18030，
        # 会因 NUL 字节让 csv 报 "line contains NUL" 而整个失败。
        sniffed = sniff_wide_encoding(read_head(path))
        if sniffed:
            ordered.append(sniffed)
    ordered.extend(_FALLBACK_ENCODINGS)
    candidates = []
    for encoding in ordered:
        if encoding not in candidates:
            candidates.append(encoding)
    return candidates


def count_rows(path):
    """返回 CSV 文件的数据行数（不包含表头行）。

    - 空文件 / 只有表头的文件：0
    - 空行会被跳过（表头之前的空行同样跳过）
    - 用 csv 模块解析，能正确处理引号内的逗号与换行
    """
    encodings = candidate_encodings(path)
    last_error = None
    for encoding in encodings:
        try:
            with open(path, newline='', encoding=encoding) as fp:
                reader = csv.reader(fp)
                header_seen = False
                rows = 0
                for row in reader:
                    if not row:  # 空行不计（包括表头前的空行）
                        continue
                    if not header_seen:
                        header_seen = True  # 第一条非空行才是表头
                        continue
                    rows += 1
                return rows  # 空文件 / 只有表头 -> 0
        except (UnicodeError, csv.Error) as exc:
            # 解码失败（例如用 UTF-8 读 GB18030 文件）时换下一种编码重试。
            # csv.Error 也要重试：宽字符文本被当成单字节编码读出来时，
            # 其中的空字节会让 csv 模块报 "line contains NUL"。
            last_error = exc
    raise RuntimeError(
        '无法用 %s 解码或解析文件: %s（最后一次失败：%s）'
        % ('/'.join(encodings), path, last_error)
    ) from last_error


def main(argv):
    if len(argv) != 2:
        print('用法: python script.py <csv文件路径>', file=sys.stderr)
        return 2
    try:
        print(count_rows(argv[1]))
    except OSError as exc:
        print('无法读取文件: %s' % exc, file=sys.stderr)
        return 1
    except (RuntimeError, UnicodeError, csv.Error) as exc:
        print('无法解析文件: %s' % exc, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
