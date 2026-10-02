"""script.py 的自检脚本（只用标准库）。

用法（在 fixtures 目录下）:
    python verify_script.py

覆盖：普通 CSV、UTF-8 BOM、GB18030 中文、空行、带引号的多行字段、
只有表头、子进程端到端调用。
"""

import os
import subprocess
import sys
import tempfile

import script


def write_bytes(path, data):
    with open(path, 'wb') as fh:
        fh.write(data)


def main():
    tmp = tempfile.mkdtemp(prefix='csv-rows-')
    ok = True

    def check(name, got, want):
        nonlocal ok
        good = got == want
        ok = ok and good
        print('{0} {1}: got={2!r} want={3!r}'.format(
            'PASS' if good else 'FAIL', name, got, want))

    # 1) 普通 UTF-8：3 数据行 + 表头
    p = os.path.join(tmp, 'plain.csv')
    write_bytes(p, 'a,b,c\n1,2,3\n4,5,6\n7,8,9\n'.encode('utf-8'))
    check('plain', script.count_rows(p), 3)

    # 2) 带 BOM 的 UTF-8
    p = os.path.join(tmp, 'bom.csv')
    write_bytes(p, '\ufeffa,b\n1,2\n3,4\n'.encode('utf-8'))
    check('utf-8-sig', script.count_rows(p), 2)

    # 3) GB18030 中文
    p = os.path.join(tmp, 'gb.csv')
    write_bytes(p, '姓名,年龄\n张三,20\n李四,30\n王五,40\n'.encode('gb18030'))
    check('gb18030', script.count_rows(p), 3)

    # 4) 空行不计
    p = os.path.join(tmp, 'blank.csv')
    write_bytes(p, 'a,b\n\n1,2\n   \n3,4\n\n'.encode('utf-8'))
    check('blank-lines', script.count_rows(p), 2)

    # 5) 带引号字段里的换行只算一行
    p = os.path.join(tmp, 'quoted.csv')
    write_bytes(p, 'a,b\n"line1\nline2",x\n"q,q",y\n'.encode('utf-8'))
    check('quoted-newline', script.count_rows(p), 2)

    # 6) 只有表头
    p = os.path.join(tmp, 'header-only.csv')
    write_bytes(p, 'a,b,c\n'.encode('utf-8'))
    check('header-only', script.count_rows(p), 0)

    # 7) 大字段（超过 csv 默认 128KB 上限）
    p = os.path.join(tmp, 'big-field.csv')
    big = 'x' * (300 * 1024)
    write_bytes(p, ('a,b\n"{0}",1\n'.format(big)).encode('utf-8'))
    check('big-field', script.count_rows(p), 1)

    # 8) 端到端：以子进程方式运行 python script.py
    for name, want in (('plain.csv', '3'), ('bom.csv', '2'), ('gb.csv', '3')):
        proc = subprocess.run(
            [sys.executable, 'script.py', os.path.join(tmp, name)],
            cwd=os.path.dirname(os.path.abspath(__file__)),
            capture_output=True, text=True)
        got = proc.stdout.strip()
        good = proc.returncode == 0 and got == want
        ok = ok and good
        print('{0} cli-{1}: rc={2} stdout={3!r} stderr={4!r} want={5!r}'.format(
            'PASS' if good else 'FAIL', name, proc.returncode, got,
            proc.stderr.strip(), want))

    print('ALL PASS' if ok else 'SOME FAILED')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
