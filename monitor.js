/**
 * TIMS 기술지원 모니터 - monitor.js
 *
 * 사용법:
 *   1. TIMS(dtims.tibero.com) 기술지원요청 목록 화면에서
 *      브라우저 콘솔(F12) 열고 이 파일 내용 붙여넣어 실행
 *   2. 또는 bookmarklet.js 의 북마크릿을 북마크바에 저장 후 클릭
 *
 * 동작:
 *   - 30초마다 기술지원요청 목록 API 호출 (화면 갱신 없음)
 *   - 신규 요청 등록 시 플로팅 패널 + 브라우저 알림(Notification) 발송
 *   - 세션 만료 감지 시 알림 후 재로그인 안내, 타이머 유지
 *   - 재로그인 후 자동으로 감시 재개
 *
 * 비교 기준:
 *   - onclick 속성에서 추출한 요청번호(TD-XXX-날짜-번호) 기준 Set
 *   - 초기 실행 시 현재 목록 전체를 기준점으로 저장 (알림 없음)
 *   - 이후 체크마다 기준점에 없는 번호 = 신규 요청으로 판단
 */

(function () {
  'use strict';

  // ===== 설정 =====
  var CHECK_INTERVAL = 30 * 1000; // 체크 주기 (ms) - 30초
  var FR_DATE = '20260101';        // 조회 시작일 (YYYYMMDD)
  var TO_DATE = '20270101';        // 조회 종료일 (YYYYMMDD)

  // ===== 상태 =====
  var knownNos   = new Set(); // 이미 알고 있는 요청번호 집합
  var isFirstRun = true;      // 초기 실행 여부
  var sessionOk  = true;      // 세션 상태
  var newCount   = 0;         // 신규 요청 누적 수

  // ===== iframe 참조 =====
  var frameDoc = document.getElementById('frameBody').contentDocument;
  var frameWin = document.getElementById('frameBody').contentWindow;

  // 기존 패널/타이머 정리
  if (frameWin._timsTimer) clearInterval(frameWin._timsTimer);
  var oldPanel = frameDoc.getElementById('timsMonitorPanel');
  if (oldPanel) oldPanel.remove();

  // ===== 패널 DOM 생성 =====
  var panel = frameDoc.createElement('div');
  panel.id = 'timsMonitorPanel';
  panel.style.cssText = [
    'position:fixed;bottom:16px;right:16px;width:340px;',
    'border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,0.4);',
    'z-index:2147483647;font-family:Malgun Gothic,sans-serif;',
    'border:1px solid #1a3a5c;background:#fff;'
  ].join('');

  var header = frameDoc.createElement('div');
  header.id = 'tims-header';
  header.style.cssText = [
    'background:#1a3a5c;color:#fff;padding:7px 11px;',
    'display:flex;align-items:center;justify-content:space-between;',
    'cursor:move;user-select:none;border-radius:8px 8px 0 0;'
  ].join('');
  header.innerHTML = [
    '<span style="font-weight:bold;font-size:12px;">TIMS 기술지원 모니터</span>',
    '<div style="display:flex;gap:5px;align-items:center;">',
      '<span id="tims-dot" style="width:9px;height:9px;border-radius:50%;background:#4caf50;display:inline-block;"></span>',
      '<span id="tims-stxt" style="font-size:10px;">감시중</span>',
      '<button id="tims-min" style="background:rgba(255,255,255,0.2);border:none;color:#fff;padding:1px 7px;border-radius:3px;cursor:pointer;font-size:11px;">_</button>',
    '</div>'
  ].join('');
  panel.appendChild(header);

  var body = frameDoc.createElement('div');
  body.id = 'tims-body';

  // 통계 바
  var stats = frameDoc.createElement('div');
  stats.style.cssText = 'background:#f0f4f8;padding:5px 11px;font-size:11px;border-bottom:1px solid #ddd;display:flex;gap:12px;';
  stats.innerHTML = '마지막: <b id="tims-lc">-</b>&nbsp; 전체: <b id="tims-tot">-</b>건&nbsp; <span style="color:#c0392b;">신규: <b id="tims-nc">0</b>건</span>';
  body.appendChild(stats);

  // 신규 요청 목록
  var nl = frameDoc.createElement('div');
  nl.id = 'tims-nl';
  nl.style.cssText = 'max-height:150px;overflow-y:auto;border-bottom:1px solid #eee;font-size:11px;display:none;';
  body.appendChild(nl);

  // 로그 영역
  var logEl = frameDoc.createElement('div');
  logEl.id = 'tims-log';
  logEl.style.cssText = 'height:80px;overflow-y:auto;padding:5px 9px;font-size:11px;font-family:monospace;background:#1e1e1e;color:#9cdcfe;';
  body.appendChild(logEl);

  // 세션 만료 알림
  var alertEl = frameDoc.createElement('div');
  alertEl.id = 'tims-alert';
  alertEl.style.cssText = 'display:none;padding:7px 11px;background:#fff3cd;border-top:2px solid #ffc107;font-size:11px;';
  alertEl.innerHTML = '⚠️ 세션 만료 — <a href="https://tims.tibero.com/login.html" target="_blank" style="color:#1a3a5c;font-weight:bold;">다시 로그인 →</a> 후 탭으로 돌아오면 자동 재개';
  body.appendChild(alertEl);

  panel.appendChild(body);
  frameDoc.body.appendChild(panel);

  // ===== 드래그 =====
  var drag = false, ox = 0, oy = 0;
  header.addEventListener('mousedown', function (e) {
    drag = true;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    ox = e.clientX - panel.getBoundingClientRect().left;
    oy = e.clientY - panel.getBoundingClientRect().top;
  });
  frameDoc.addEventListener('mousemove', function (e) {
    if (drag) {
      panel.style.left = (e.clientX - ox) + 'px';
      panel.style.top  = (e.clientY - oy) + 'px';
    }
  });
  frameDoc.addEventListener('mouseup', function () { drag = false; });

  // ===== 최소화 =====
  frameDoc.getElementById('tims-min').addEventListener('click', function () {
    var b = frameDoc.getElementById('tims-body');
    var min = b.style.display === 'none';
    b.style.display = min ? 'block' : 'none';
    this.textContent = min ? '_' : '+';
  });

  // ===== 로그 =====
  function timsLog(msg, col) {
    var el = frameDoc.getElementById('tims-log');
    if (!el) return;
    var d = frameDoc.createElement('div');
    d.style.color = col || '#9cdcfe';
    d.textContent = new Date().toLocaleTimeString() + '  ' + msg;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
    while (el.children.length > 80) el.removeChild(el.firstChild);
  }

  // ===== 상태 표시 =====
  function timsSetStatus(ok, txt) {
    var dot  = frameDoc.getElementById('tims-dot');
    var stxt = frameDoc.getElementById('tims-stxt');
    var al   = frameDoc.getElementById('tims-alert');
    if (dot)  dot.style.background = ok ? '#4caf50' : '#e74c3c';
    if (stxt) stxt.textContent = txt;
    if (al)   al.style.display = ok ? 'none' : 'block';
  }

  // ===== 신규 요청 추가 =====
  function timsAddNew(r) {
    newCount++;
    var nc = frameDoc.getElementById('tims-nc');
    if (nc) nc.textContent = newCount;
    var list = frameDoc.getElementById('tims-nl');
    if (list) {
      list.style.display = 'block';
      var row = frameDoc.createElement('div');
      row.style.cssText = 'padding:5px 9px;border-bottom:1px solid #eee;background:#fff8e1;';
      row.innerHTML = [
        '<b style="color:#c0392b;font-size:10px;">NEW</b> ',
        '<span style="font-size:11px;color:#333;">' + r.no + '</span><br>',
        '<span style="color:#444;">' + r.project + '</span><br>',
        '<span style="color:#888;font-size:10px;">담당: ' + (r.assignee || '미배정') + ' | ' + r.status + ' | ' + r.reqDate + '</span>'
      ].join('');
      list.insertBefore(row, list.firstChild);
    }
  }

  // ===== API 호출 =====
  function timsFetchList() {
    var p = new URLSearchParams({
      gbWork: 'LIST', pageCls: 'REQUEST', cReqNo: '', isAdmin: 'false',
      cFrDate: FR_DATE, cToDate: TO_DATE, ccReqNo: '',
      cSaleDept: '0001', cSaleDeptHier: 'Y',
      cSaleEmpNm: '', cSaleEmp: '',
      cCompNm: '', cCompCd: '',
      cAssignDept: '2656', cAssignDeptHier: 'Y', cAssignDeptAll: 'Y',
      cPrjtNm: '', cPrjtCd: '',
      cReqEmpNm: '', cReqEmp: '',
      cServiceCls: '', cPsProdCls: '',
      cReqTel: '', cReqNm: '',
      listTable_length: '100'
    });
    ['Y', '010', '020', '030'].forEach(function (v) { p.append('listReqState', v); });

    return fetch(
      'https://dtims.tibero.com/pscenter/techsupport/findTechServiceRequestList.screen',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: p.toString()
      }
    ).then(function (res) {
      if (!res.ok) throw new Error('HTTP_' + res.status);
      return res.text();
    }).then(function (html) {
      var hasTable   = html.indexOf('listTable') >= 0;
      var titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/);
      var title      = titleMatch ? titleMatch[1] : '';
      if (!hasTable || title.indexOf('기술지원요청목록') < 0) {
        throw new Error('SESSION_EXPIRED');
      }
      var doc = new DOMParser().parseFromString(html, 'text/html');
      return Array.from(doc.querySelectorAll('#listTable tbody tr')).map(function (row) {
        var c = Array.from(row.querySelectorAll('td')).map(function (td) {
          return td.textContent.trim().replace(/\s+/g, ' ');
        });
        var m = (row.getAttribute('onclick') || '').match(/'(TD-[^']+)'/);
        return {
          no:       m ? m[1] : null,
          reqDate:  c[1]  || '',
          project:  (c[5]  || '').substring(0, 44),
          assignee: c[12] || '',
          status:   c[13] || ''
        };
      }).filter(function (r) { return !!r.no; });
    });
  }

  // ===== 체크 함수 =====
  function timsCheck() {
    timsFetchList().then(function (rows) {
      if (!sessionOk) {
        sessionOk = true;
        timsSetStatus(true, '감시중');
        timsLog('✅ 세션 복구 - 감시 재개', '#4caf50');
      }

      var lc = frameDoc.getElementById('tims-lc');
      if (lc) lc.textContent = new Date().toLocaleTimeString();
      var tt = frameDoc.getElementById('tims-tot');
      if (tt) tt.textContent = rows.length;

      var found = [];
      rows.forEach(function (r) {
        if (isFirstRun) {
          knownNos.add(r.no);
        } else if (!knownNos.has(r.no)) {
          found.push(r);
          knownNos.add(r.no);
        }
      });

      if (isFirstRun) {
        timsLog('🚀 감시 시작: ' + rows.length + '건 기준점 기록', '#4caf50');
        isFirstRun = false;
        return;
      }

      if (found.length === 0) {
        timsLog('변경 없음 (' + rows.length + '건)');
      } else {
        found.forEach(function (r) {
          timsLog('🔔 신규 요청: ' + r.no + ' ' + r.project, '#f9c74f');
          timsAddNew(r);
          if (Notification.permission === 'granted') {
            var n = new Notification('🔔 신규 기술지원 요청', {
              body: r.no + '\n' + r.project + '\n담당: ' + (r.assignee || '미배정') + ' | ' + r.status,
              requireInteraction: true
            });
            n.onclick = function () { window.focus(); n.close(); };
          }
        });
      }

    }).catch(function (e) {
      var msg = e.message || '';
      if (msg.indexOf('SESSION_EXPIRED') >= 0) {
        if (sessionOk) {
          sessionOk = false;
          timsSetStatus(false, '세션만료');
          timsLog('⚠️ 세션 만료 - 로그인 필요 (30초마다 재시도)', '#e74c3c');
          if (Notification.permission === 'granted') {
            new Notification('⚠️ TIMS 세션 만료', {
              body: '로그인이 필요합니다.',
              requireInteraction: true
            });
          }
        } else {
          timsLog('세션 만료 지속... (재시도 대기)', '#e74c3c');
        }
      } else {
        timsLog('❌ 오류: ' + msg, '#e74c3c');
      }
    });
  }

  // ===== 시작 =====
  if (Notification.permission === 'default') Notification.requestPermission();
  timsCheck();
  frameWin._timsTimer = setInterval(timsCheck, CHECK_INTERVAL);
  timsLog('⏰ 30초 자동 체크 시작', '#4caf50');

  console.log('[TIMS] 모니터 시작 | 정지: clearInterval(frameWin._timsTimer)');
})();
