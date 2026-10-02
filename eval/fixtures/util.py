def parse(s):
    """解析逗号分隔字符串为列表。空输入（None / 空串 / 全空白）返回空列表。"""
    if s is None:
        return []
    if not s.strip():
        return []
    return [item.strip() for item in s.split(',') if item.strip()]