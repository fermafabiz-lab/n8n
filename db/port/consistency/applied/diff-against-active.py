import json, re, sys
def load(f):
    d=json.load(open(f)); return d.get('workflow',d)
def nodes(w): return {n['name']:n for n in w['nodes']}
def edges(w):
    out=set()
    for src,m in w['connections'].items():
        for ctype,outs in m.items():
            for i,lst in enumerate(outs or []):
                for c in (lst or []):
                    out.add((src,ctype,i,c['node'],c.get('type','main'),c.get('index',0)))
    return out
def strip(n):
    n=dict(n); 
    for k in ('position','id'): n.pop(k,None)
    return n
def check(label, rawf, draftf, opsf):
    raw,draft=load(rawf),load(draftf)
    rn,dn=nodes(raw),nodes(draft)
    ops=json.load(open(opsf))
    print(f'=== {label}: active {raw["activeVersionId"][:8]} -> draft {draft["versionId"][:8]} (draft.active={draft["activeVersionId"][:8]})')
    added=set(dn)-set(rn); removed=set(rn)-set(dn)
    changed=[k for k in rn if k in dn and strip(rn[k])!=strip(dn[k])]
    print(' added:',sorted(added)); print(' removed:',sorted(removed)); print(' changed:',sorted(changed))
    # what the ops intended
    exp_add={o['node']['name'] for o in ops if o['type']=='addNode'}
    exp_rm={o['nodeName'] for o in ops if o['type']=='removeNode'}
    exp_chg={o['nodeName'] for o in ops if o['type'] in ('updateNodeParameters','setNodeParameter','setNodeSettings')}
    print(' expected add:',sorted(exp_add-added) and ('MISSING '+str(sorted(exp_add-added))) or 'ok', '| unexpected add:', sorted(added-exp_add) or 'none')
    print(' expected rm :', sorted(exp_rm-removed) and ('MISSING '+str(sorted(exp_rm-removed))) or 'ok', '| unexpected rm:', sorted(removed-exp_rm) or 'none')
    print(' unexpected changed:', sorted(set(changed)-exp_chg-exp_add) or 'none')
    # parameters verbatim
    bad=[]
    for o in ops:
        if o['type']=='updateNodeParameters':
            n=dn.get(o['nodeName'])
            if not n: bad.append(('nonode',o['nodeName'])); continue
            for k,v in o['parameters'].items():
                if n['parameters'].get(k)!=v: bad.append(('param',o['nodeName'],k))
        elif o['type']=='addNode':
            n=dn.get(o['node']['name'])
            if not n: bad.append(('noadd',o['node']['name'])); continue
            for k,v in (o['node'].get('parameters') or {}).items():
                if n['parameters'].get(k)!=v: bad.append(('addparam',o['node']['name'],k))
            if n['type']!=o['node']['type']: bad.append(('type',o['node']['name']))
        elif o['type']=='setNodeSettings':
            n=dn.get(o['nodeName'])
            for k,v in o['settings'].items():
                if n.get(k)!=v: bad.append(('setting',o['nodeName'],k,n.get(k),v))
    print(' param/setting mismatches:', bad or 'none')
    # edges
    re_,de=edges(raw),edges(draft)
    exp_addc={(o['source'],o.get('connectionType','main'),o.get('sourceIndex',0),o['target'],'main',o.get('targetIndex',0)) for o in ops if o['type']=='addConnection'}
    exp_rmc={(o['source'],o.get('connectionType','main'),o.get('sourceIndex',0),o['target'],'main',o.get('targetIndex',0)) for o in ops if o['type']=='removeConnection'}
    # edges to removed nodes vanish implicitly
    gained=de-re_; lost=re_-de
    print(' edges gained not in ops:', sorted(gained-exp_addc) or 'none')
    print(' ops edges not gained:', sorted(exp_addc-gained) or 'none')
    lost_unexp={e for e in lost-exp_rmc if e[0] not in removed and e[3] not in removed}
    print(' edges lost not in ops:', sorted(lost_unexp) or 'none')
    print(' ops edges not lost:', sorted(exp_rmc-lost) or 'none')
    # dangling refs
    dang=set()
    for n in dn.values():
        for m in re.finditer(r"\$\(\s*'([^']+)'\s*\)", json.dumps(n['parameters'])):
            if m.group(1) not in dn: dang.add((n['name'],m.group(1)))
    print(' dangling $() refs:', sorted(dang) or 'none')
    # drive nodes
    drv=[(n['name'],n['parameters'].get('resource'),n['parameters'].get('operation')) for n in dn.values() if 'googleDrive' in n['type']]
    print(' drive nodes missing op:', [d for d in drv if not d[2]] or 'none', f'({len(drv)} drive nodes)')
    # settings
    print(' settings equal:', raw.get('settings')==draft.get('settings'))
    print(' node count', len(rn),'->',len(dn))
check('Media Generation','mg.raw.json','mg.draft.json','opsMG.json')
check('Claude Scripting','cs.raw.json','cs.draft.json','opsCS.json')
