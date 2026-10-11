#!/usr/bin/env python3
"""Optional browser check of the customer features in local demo mode (not part of npm test).

Needs Playwright for Python and its Chromium (pip install playwright && playwright install chromium), and the demo
served locally:  ./scripts/sync-core.sh && (cd frontend && python3 -m http.server 8080)
Usage: python3 scripts/e2e-customer.py [--base http://localhost:8080] [--shots /tmp/pn-shots]

Walks: request form (voice-typing control, matches with reasons, consent) → technician accepts and opens the job →
diagnosis → customer request page → owner page (nothing preselected, agree required) → repair confirmed →
verified points and Green Passport → brand PDF download → Hindi pass and a 360 px pass for overflow.
Fails on any console error, missing translation key, or broken step.
"""
import argparse, base64, os, sys
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8080')
ap.add_argument('--shots', default='')
args = ap.parse_args()
BASE = args.base.rstrip('/')
problems, steps = [], []

def step(name):
    steps.append(name)
    print(f'  ✓ {name}')

def shot(page, name):
    if args.shots:
        os.makedirs(args.shots, exist_ok=True)
        page.screenshot(path=f'{args.shots}/{name}.png', full_page=True)

def api(page, method, path, body=None):
    return page.evaluate("""async ([m, p, b]) => { const { call } = await import('./js/api.js'); return call(m, p, b); }""", [method, path, body])

def persona(page, uid):
    page.wait_for_timeout(400)  # demo mode saves to localStorage after a short debounce; let it land before reloading
    page.goto(f'{BASE}/#/')
    page.wait_for_selector('[data-persona]')
    page.select_option('[data-persona]', uid)
    page.wait_for_timeout(600)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1200, 'height': 900}, accept_downloads=True)
    page = ctx.new_page()
    # Resource errors are judged by URL (requestfailed): only the app's own files count. External fonts and the QR
    # library are optional, and the app works without them (for example offline).
    noisy = lambda m: m.type == 'error' and m.text.startswith('Failed to load resource')
    page.on('console', lambda m: not noisy(m) and (m.type == 'error' or (m.type == 'warning' and 'missing' in m.text.lower())) and problems.append(f'{m.type}: {m.text}'))
    page.on('requestfailed', lambda r: r.url.startswith(BASE) and 'ERR_ABORTED' not in (r.failure or '') and problems.append(f'failed to load {r.url} ({r.failure})'))
    page.on('pageerror', lambda e: problems.append(f'pageerror: {e}'))

    # 1. Sign in as a customer (seeded demo account) and report a defective appliance from "My repairs"
    persona(page, 'demo-sunita')
    page.wait_for_url('**#/my')
    page.wait_for_selector('.pts-big .n')
    points_before = int(page.get_attribute('.pts-big .n', 'data-count'))  # the visible number animates up to this
    seeded = page.locator('.row-link').count()
    step(f'customer Sunita signed in: My repairs shows {seeded} seeded item(s) and {points_before} points')
    page.click('text=Report a defective appliance')
    page.wait_for_selector('[data-form]')
    assert page.input_value('[name=phone]') == '9876543210', 'customer details are prefilled'
    page.select_option('[data-cat]', 'washing_machine')
    page.fill('[name=brand]', 'Brand X')
    page.fill('[name=model]', 'WM-7')
    page.select_option('[name=ageBand]', '1-3')
    page.click('[data-sym=error_code]')
    page.fill('textarea[name=description]', 'The drum does not spin and it shows an error code.')
    page.fill('[name=pincode]', '282002')
    page.fill('[name=phone]', '9876543210')
    page.fill('[name=name]', 'Sunita')
    page.wait_for_timeout(300)
    mics = page.locator('.mic-btn').count()
    note = page.locator('.voice-unavailable').count()
    assert mics > 0 or note > 0, 'voice typing is either offered or explained'
    step(f'request form renders; voice typing {"offered on " + str(mics) + " fields" if mics else "explained as unavailable"}')
    page.click('[data-send]')
    page.wait_for_timeout(300)
    assert '#/repair' in page.url, 'cannot send before finding technicians'
    page.click('[data-find]')
    page.wait_for_selector('[data-tech]')
    assert page.locator('.reasons li').count() >= 2
    step(f'{page.locator("[data-tech]").count()} technicians suggested with reasons')
    page.click('[data-send]')
    page.wait_for_timeout(300)
    assert '#/repair' in page.url, 'consent is required'
    page.check('[data-consent]')
    form_model = page.input_value('[name=model]')
    page.click('[data-send]')
    page.wait_for_url('**#/req/**')
    page.wait_for_selector('.cj-panel')
    req_url = page.url
    assert form_model == 'WM-7', f'model typed in the form was lost: {form_model!r}'
    assert page.locator('text=Request sent').count() == 1
    shot(page, '1-request-sent')
    step('request sent; status page shows the journey')

    # 2. Technician accepts and opens the job; diagnosis through the same API the diagnose form uses
    rid = req_url.split('#/req/')[1].split('/')[0]
    persona(page, 'demo-ravi')
    page.goto(f'{BASE}/#/t/requests')
    page.wait_for_selector(f'[data-accept="{rid}"]')
    assert '9876543210' not in page.locator(f'section:has([data-accept="{rid}"])').inner_text(), 'phone hidden before accepting'
    page.click(f'[data-accept="{rid}"]')
    page.wait_for_selector(f'[data-job="{rid}"]')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(600)  # the list re-renders after Accept (and its page transition); fill the settled form
    assert '9876543210' in page.locator(f'section:has([data-job="{rid}"])').inner_text(), 'phone shown after accepting'
    page.fill(f'[data-job="{rid}"] [name=brand]', 'Brand X')   # the technician confirms what they see on the label
    page.fill(f'[data-job="{rid}"] [name=model]', 'WM-7')
    page.fill(f'[data-job="{rid}"] [name=purchaseYear]', '2024')
    page.click(f'[data-job="{rid}"] button[type=submit]')
    try:
        page.wait_for_url('**#/t/job/**', timeout=10000)
    except Exception:
        toast = page.evaluate("document.querySelector('.toast') ? document.querySelector('.toast').textContent : ''")
        raise AssertionError(f'job not opened; toast: {toast}; url {page.url}')
    job_id = page.url.split('/')[-1]
    step(f'technician accepted; contact revealed only after accepting; job {job_id} opened')
    api(page, 'POST', f'/api/jobs/{job_id}/diagnosis', {'component': 'control_board', 'causes': ['voltage_surge'], 'severity': 'replace_part', 'spare': 'brand', 'photoKey': 'uploads/demo-ravi/x.jpg', 'quote': {'parts': 3000, 'labour': 600}, 'offerWarrantyDays': 90, 'techSuggests': 'repair_new'})
    page.goto(f'{BASE}/#/t/job/{job_id}')
    page.wait_for_timeout(2500)
    page.reload()
    page.wait_for_selector('text=Waiting for the customer to choose')
    assert '/#/o/' not in page.content(), 'no owner link for request jobs'
    step('technician sees no owner link for a request job')

    # 3. Customer: back in My repairs the appliance needs a decision → owner page; nothing preselected; agree required
    persona(page, 'demo-sunita')
    page.wait_for_selector('.note.warn a.btn')
    page.wait_for_timeout(400)
    page.goto(req_url)
    page.wait_for_selector('text=Open my repair page')
    page.click('text=Open my repair page')
    page.wait_for_selector('[data-opt]')
    assert page.locator('[data-opt][aria-pressed=true]').count() == 0, 'no option preselected'
    assert page.is_disabled('[data-confirm]')
    page.click('[data-opt=repair_new]')
    page.wait_for_selector('.terms-box')
    assert page.is_disabled('[data-confirm]'), 'still disabled until agreeing'
    assert page.locator('text=90 days offered by the technician').count() == 1
    page.click('.compare-wrap summary')
    shot(page, '2-owner-terms')
    page.check('[data-agree]')
    assert not page.is_disabled('[data-confirm]')
    page.click('[data-opt=harvest]')
    assert page.is_disabled('[data-confirm]'), 'changing the option clears the agreement'
    page.click('[data-opt=repair_new]')
    page.check('[data-agree]')
    page.click('[data-confirm]')
    page.wait_for_selector('text=You agreed to')
    owner_url = page.url
    step('owner page: explicit selection, per-option agreement, decision recorded')

    # 4. Repair complete and confirmed → verified points → Green Passport
    persona(page, 'demo-ravi')
    api(page, 'POST', f'/api/jobs/{job_id}/complete', {'partSource': 'new', 'amount': 3600, 'warrantyDays': 90})
    persona(page, 'demo-sunita')
    page.wait_for_timeout(400)
    page.goto(owner_url)
    page.wait_for_selector('[data-confirm-work=yes]')
    assert page.locator('.reward-list').count() == 0, 'no points before confirmation'
    page.click('[data-confirm-work=yes]')
    page.wait_for_selector('.reward-list')
    assert page.locator('text=+20 points').count() >= 1
    page.click('[data-green]')
    page.wait_for_url('**#/g/**')
    page.wait_for_selector('.badge-card.earned')
    page.wait_for_timeout(1500)
    after = int(page.get_attribute('.pts-big .n', 'data-count'))
    assert after == points_before + 20, f'{points_before} + 20 != {after}'
    shot(page, '3-green-passport')
    step(f'confirmation awards 20 verified points: Green Passport {points_before} -> {after}')

    # 4b. Every other role's seeded work is there and renders
    for who, route, sel, what in [('demo-shyam', '#/c', '[data-accept], .row-link, .card', 'collector pickups'),
                                  ('demo-green', '#/r', '[data-confirm], .row-link, .card', 'recycler deliveries'),
                                  ('demo-imran', '#/parts', 'main h1', 'parts exchange'),
                                  ('demo-admin', '#/admin', 'h1', 'admin'),
                                  ('', '#/market', '.badge.syn', 'ReLife listing labelled Demo')]:
        if who: persona(page, who)
        else: persona(page, '')
        page.goto(f'{BASE}/{route}')
        page.wait_for_selector(sel, timeout=15000)
        assert page.locator('.empty h3').count() == 0 or route == '#/parts', f'{what} shows an error'
    step('seeded work renders for collector, recycler, parts exchange, admin and ReLife (Demo label shown)')

    # 5. Brand PDF download
    persona(page, 'demo-priya')
    page.goto(f'{BASE}/#/b/WM-7')
    page.wait_for_selector('[data-csv]')  # the model report page (the models list has a PDF button too)
    page.click('[data-pdf-open]')
    page.fill('[name=from]', '2026-01')
    with page.expect_download() as dl:
        page.click('[data-pdf] button[type=submit]')
    path = dl.value.path()
    data = open(path, 'rb').read()
    assert data[:8] == b'%PDF-1.4' and b'%%EOF' in data[-10:]
    step(f'brand PDF downloaded: {dl.value.suggested_filename}, {len(data)} bytes')
    page.click('[data-assist-design] [data-assist-run]')
    page.wait_for_selector('[data-assist-out] .badge')
    src = page.locator('[data-assist-out] .badge').first.inner_text()
    assert page.locator('[data-assist-out] .assist-list li').count() >= 1, 'rule-based design suggestions shown'
    step(f'design assistant answered ({src})')
    page.goto(f'{BASE}/#/search/WM-7')
    page.wait_for_selector('[data-engine]')
    engine = page.get_attribute('[data-engine]', 'data-engine')
    assert page.locator('a[href="#/scores"]').count() >= 1, 'model results'
    step(f'search page returns models (engine: {engine})')
    page.goto(f'{BASE}/#/stack')
    page.wait_for_selector('[data-tool]')
    tools = page.locator('[data-tool]').count()
    states = page.evaluate("Object.fromEntries([...document.querySelectorAll('[data-tool]')].map(e => [e.dataset.tool, e.dataset.state]))")
    assert tools == 11, f'{tools} tools listed'
    step('Build It stack page lists 11 tools with live states: ' + ', '.join(f'{k}={v}' for k, v in states.items()))

    # 6. Hindi and a narrow phone: no missing keys, no sideways scrolling
    # Same browser profile (the demo data lives in its localStorage), narrowed to a phone.
    m = page
    m.set_viewport_size({'width': 360, 'height': 780})
    persona(m, '')
    for url in [f'{BASE}/?lang=hi#/repair', req_url.replace('#/', '?lang=hi#/'), owner_url]:
        m.goto(url)
        m.wait_for_timeout(1500)
        assert m.locator('.empty h3').count() == 0, f'error page on {url}'
        over = m.evaluate('document.documentElement.scrollWidth - window.innerWidth')
        if over > 2: problems.append(f'horizontal overflow {over}px on {url}')
    shot(m, '4-mobile-owner')
    step('Hindi and 360 px passes')

    # 7. The app's own i18n debug checker (?i18n-debug=1) on every new page, in all five languages
    green_url = page.url if '#/g/' in page.url else None
    page.goto(f'{BASE}/#/'); page.wait_for_selector('[data-persona]')
    greens = page.evaluate("() => JSON.parse(localStorage.getItem('pn-green') || 'null')")
    green_hash = f"#/g/{greens['cid']}/{greens['t']}"
    req_hash, owner_hash = req_url.split('#', 1)[1], owner_url.split('#', 1)[1]
    flagged = {}
    for code in ['en', 'hi', 'mr', 'bn', 'ta']:
        for h in ['/repair', '/stack', '#' + req_hash, '#' + owner_hash, green_hash, ('tech', '/t/requests'), ('cust', '/my')]:
            if isinstance(h, tuple):
                persona(m, 'demo-ravi' if h[0] == 'tech' else 'demo-sunita'); h = h[1]
            hh = h if h.startswith('#') else '#' + h
            m.goto(f'{BASE}/?i18n-debug=1&lang={code}{hh}')
            m.wait_for_timeout(1200)
            assert m.locator('.empty h3').count() == 0 or hh == '#/t/requests', f'error page on {hh}'
            issues = m.evaluate('(window.__i18nIssues ? window.__i18nIssues() : []).map(x => x.text)')
            if issues: flagged[f'{code} {hh[:24]}'] = issues[:3]
        m.goto(f'{BASE}/#/'); m.wait_for_selector('[data-persona]'); m.select_option('[data-persona]', '')
    for k, v in flagged.items(): problems.append(f'untranslated on {k}: {v}')
    step('i18n debug checker on the new pages in en, hi, mr, bn, ta' + (f' ({len(flagged)} flagged)' if flagged else ': nothing flagged'))
    browser.close()

print(f'\n{len(steps)} steps passed')
if problems:
    print('Problems:'); [print('  -', x) for x in problems]
    sys.exit(1)
