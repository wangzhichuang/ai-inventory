"""读取本机 Codex 和 Claude 的资产，只向界面投影需要的字段。"""
import hashlib
import json
import re
import tomllib
from datetime import datetime, timezone
from pathlib import Path


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def text_meta(body, fallback):
    lines = body.splitlines()
    fields = {}
    start = 0
    if lines and lines[0].strip() == '---' and '---' in lines[1:]:
        start = lines.index('---', 1) + 1
        key = ''
        for line in lines[1:start-1]:
            match = re.match(r'^(name|description):\s*(.*)', line)
            if match:
                key, value = match.groups()
                fields[key] = value.strip().strip('"\'')
                if fields[key] in ('|', '>', '|-', '>-'):
                    fields[key] = ''
            elif key and line.startswith(' '):
                fields[key] += ' ' + line.strip()
            else:
                key = ''
    rest = [s.strip() for s in lines[start:] if s.strip()]
    title = next((s.lstrip('# ') for s in rest if re.match(r'^#{1,2} ', s)), fallback)
    intro = next((s for s in rest if not s.startswith(('#', '---', '```')) and
                  not re.match(r'^[\w-]+:\s', s)), '')
    return fields.get('name') or title, (fields.get('description') or intro).strip()[:520]


class Inventory:
    def __init__(self, home, projects=()):
        self.home = home
        self.projects = set(projects)
        self.rows = {}
        self.files = {}
        self.warnings = set()
        self.docs = {}

    def label(self, path):
        return '~/' + str(path.relative_to(self.home)) if path.is_relative_to(self.home) else str(path)

    def config(self, path):
        if not path.is_file():
            return {}
        try:
            data = path.read_bytes()
            obj = tomllib.loads(data.decode()) if path.suffix == '.toml' else json.loads(data)
            if not isinstance(obj, dict):
                raise ValueError()
            return obj
        except (ValueError, OSError):
            self.warnings.add(self.label(path))
            return {}

    def add(self, identity, kind, title, description, path, app, scope, group, status='', doc=False):
        key = digest(identity)
        row = self.rows.setdefault(key, dict(id=key, kind=kind, title=title, description=description,
                                            sources=[], groups=[], updated=0))
        source = dict(app=app, scope=scope, path=self.label(path), status=status)
        if source not in row['sources']:
            row['sources'].append(source)
        if group not in row['groups']:
            row['groups'].append(group)
        row['updated'] = max(row['updated'], int(path.stat().st_mtime))
        if doc:
            self.files[key] = path

    def document(self, path, kind, app, scope, group):
        try:
            real = path.resolve()
            if real not in self.docs:
                body = real.read_text(errors='replace')
                title, summary = text_meta(body, real.parent.name if kind == 'skill' else real.stem)
                self.docs[real] = title, summary, digest(body)
            title, summary, fingerprint = self.docs[real]
            self.add(kind + ':' + fingerprint, kind, title, summary, path, app, scope, group, doc=True)
        except (OSError, RuntimeError):
            self.warnings.add(self.label(path))

    def memory(self, root, app, scope, recursive=True):
        if not root.is_dir():
            return
        for p in root.rglob('*.md') if recursive else root.glob('*.md'):
            rel = p.relative_to(root)
            if any(x.startswith('.') for x in rel.parts):
                continue
            group = '归档记忆' if 'archive' in rel.parts else '长期记忆'
            if p.name in ('MEMORY.md', 'README.md'):
                group = '记忆索引'
            self.document(p, 'memory', app, scope, group)

    def skills(self, folder, app, scope, group='个人 Skill'):
        for p in folder.glob('*/SKILL.md'):
            if not p.parent.name.startswith('.'):
                self.document(p, 'skill', app, scope, group)

    def servers(self, mapping, path, app, scope, status='已配置'):
        if not isinstance(mapping, dict):
            return
        for name, cfg in mapping.items():
            if not isinstance(cfg, dict):
                continue
            actual = '已停用' if cfg.get('enabled') is False or cfg.get('disabled') is True else status
            # 配置可能包含认证信息。仅提取服务名和状态。
            self.add('mcp:' + name, 'mcp', name, '', path, app, scope, 'MCP 服务', actual)

    def plugin(self, folder, app, name, status):
        scope = '插件 · ' + name + ' · ' + status
        self.skills(folder/'skills', app, scope, '插件 Skill')
        manifest = folder/('.codex-plugin' if app == 'Codex' else '.claude-plugin')/'plugin.json'
        cfg = self.config(manifest)
        paths = cfg.get('skills', [])
        for rel in ([paths] if isinstance(paths, str) else paths if isinstance(paths, list) else []):
            if isinstance(rel, str):
                root = folder/rel
                if (root/'SKILL.md').is_file():
                    self.document(root/'SKILL.md', 'skill', app, scope, '插件 Skill')
                else:
                    self.skills(root, app, scope, '插件 Skill')
        inline = cfg.get('mcpServers')
        if isinstance(inline, dict):
            self.servers(inline, manifest, app, scope, status)
        candidates = [inline] if isinstance(inline, str) else inline if isinstance(inline, list) else []
        for rel in set(['.mcp.json', 'mcp.json'] + [r for r in candidates if isinstance(r, str)]):
            p = folder/rel
            data = self.config(p)
            self.servers(data.get('mcpServers', data), p, app, scope, status)

    def scan(self):
        h = self.home
        codex, claude = h/'.codex', h/'.claude'
        cpath, apath = codex/'config.toml', h/'.claude.json'
        cc, ac = self.config(cpath), self.config(apath)
        self.servers(cc.get('mcp_servers'), cpath, 'Codex', '用户配置')
        self.servers(ac.get('mcpServers'), apath, 'Claude', '用户配置')
        for name, cfg in ac.get('projects', {}).items():
            self.projects.add(Path(name))
            self.servers(cfg.get('mcpServers'), apath, 'Claude', '项目 · ' + name)
        self.projects.update(Path(s) for s in cc.get('projects', {}))
        for p in sorted(self.projects):
            if not p.is_absolute() or not p.is_dir() or p == h:
                continue
            scope = '项目 · ' + self.label(p)
            for rel, app in [('.agents/skills','Codex'), ('.codex/skills','Codex'), ('.claude/skills','Claude')]:
                self.skills(p/rel, app, scope, '项目 Skill')
            for path, app, key in [(p/'.mcp.json','Claude','mcpServers'), (p/'.codex/config.toml','Codex','mcp_servers')]:
                self.servers(self.config(path).get(key), path, app, scope)
            for f, app in [('AGENTS.md','Codex'),('CLAUDE.md','Claude'),('.claude/CLAUDE.md','Claude')]:
                if (p/f).is_file():
                    self.document(p/f,'memory',app,scope,'协作规则')
        for f, app in [(codex/'AGENTS.md','Codex'), (claude/'CLAUDE.md','Claude')]:
            if f.is_file():
                self.document(f,'memory',app,'全局','协作规则')
        self.memory(codex/'memory','Codex','手写记忆')
        for root in (claude/'projects').glob('*/memory'):
            self.memory(root,'Claude','项目记忆')
        for version in ('memories_v2','memories'):
            root = codex/version
            for p in (root/'rollout_summaries').glob('*.md'):
                self.document(p,'memory','Codex',version,'会话摘要')
            for p in (root/'extensions/ad_hoc/notes').glob('*.md'):
                self.document(p,'memory','Codex',version,'补充记忆')
            for f in ('MEMORY.md','memory_summary.md'):
                if (root/f).is_file():
                    self.document(root/f,'memory','Codex',version,'记忆索引')
        for root, app in [(h/'.agents/skills','Codex'),(codex/'skills','Codex'),(claude/'skills','Claude')]:
            self.skills(root,app,'用户目录')
        self.skills(codex/'skills/.system','Codex','系统目录','系统 Skill')
        enabled = self.config(claude/'settings.json').get('enabledPlugins', {})
        for name, installs in self.config(claude/'plugins/installed_plugins.json').get('plugins',{}).items():
            for item in installs:
                if item.get('installPath'):
                    flag = enabled.get(name)
                    status = {True:'已启用',False:'已停用'}.get(flag,'已安装')
                    self.plugin(Path(item['installPath']),'Claude',name,status)
        plugins = cc.get('plugins',{})
        for root in (codex/'plugins/cache').glob('*/*'):
            versions = [p for p in root.glob('*') if p.is_dir() and not p.name.startswith('.')]
            if not versions:
                continue
            # 缓存可能保留旧版本。配置无法确定运行版本时，展示最新缓存并明确标记。
            folder = max(versions, key=lambda p: tuple((1,int(x)) if x.isdigit() else (0,x) for x in re.split(r'(\d+)',p.name)))
            name = root.name+'@'+root.parent.name
            flag = plugins.get(name,{}).get('enabled')
            status = {True:'配置启用',False:'已停用'}.get(flag,'缓存可见')
            self.plugin(folder,'Codex',name,status)
        return dict(items=list(self.rows.values()), warnings=sorted(self.warnings),
                    scanned=datetime.now(timezone.utc).isoformat())
