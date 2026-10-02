def parse(s):
    """解析逗号分隔字符串为列表。

    空输入的几种形态都返回空列表：
      - None
      - 空字符串 / 全空白字符串
      - 只由逗号分隔出的空字段，例如 "," / "a,," / ",,,"
    切分后会去掉每项首尾空白，并丢弃空项，因此不会返回 [''] 这类结果。
    非字符串输入（如 bytes、数字）统一抛 TypeError，避免静默出错。
    不会进入 split，因此空输入永远返回空列表 [] 而不是 ['']。
    """
    if s is None:
        return []
    if isinstance(s, bytes):
        # bytes 的 split 结果也是 bytes，容易与 str 混用出错；
        # 显式拒绝，让调用方先解码。
        raise TypeError('parse() 需要 str，收到 bytes：请先用 decode() 解码')
    if not isinstance(s, str):
        raise TypeError('parse() 需要 str，收到 %s' % type(s).__name__)
    if s.strip() == '':
        # 空字符串、纯空白，以及 "," / ",,," 这类只由分隔符组成的输入
        return []
    return [item.strip() for item in s.split(',') if item.strip() != '']
