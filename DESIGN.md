# Idle Island — 설계서 (퀘스트 #19177)

작성 2026-11-13. 빌드 목표: 한 세션, JS 약 2,300줄. `[추정]` 표시는 검증하지 않은 가정이다.
검증한 것: 던지기 규칙과 상수는 프로토타입으로 전수 계산했다(§1.6). 그 외 숫자(토큰·비용·모델 능력)는 전부 추정이다.

## 0. 한 줄 설계와 판정

**모델이 과제 없이 섬에서 놀며 직접 노트를 쓰고, 엔진이 모든 행동을 검사해 발견을 기록한다. 그 노트를 가진 에이전트와 빈 노트 에이전트가 같은 목표 과제를 풀고, 엔진이 채점한다. 로그인 없이는 녹화된 행동을 엔진이 다시 돌려서 본다.**

요청한 각도(논문 5장 축소 재현)는 유지한다. 승인된 두 앱은 "빈 방에서 말하고 행동"이고, 논문의 실험 자체(놀이 → 노트 → 0시간 대 30시간 → 기억 삭제)를 만든 앱은 없다. 플레이북 4가지에 모두 맞는다. 다만 세 가지를 바꾼다.

1. **세계는 옆에서 본 1차원 띠(열 24개 + 높이)로 한다.** 2D 격자보다 규칙이 적고, 탑·Peak·Spire·던진 궤적이 그림 한 장에 보인다. 대가: 탑이 길을 막는다(§10 R4).
2. **머리기사는 점수 통계가 아니라 "기법을 실제로 썼는가"이다.** n=2로는 점수 차이를 주장할 수 없다. 대신 탐지기가 평가 중에도 돌아서 "played는 6번째 행동에서 rock shatter를 썼고, fresh와 erased는 한 번도 안 썼다"를 보여준다. 이건 표본 크기와 무관한 사실이다.
3. **기억 삭제는 화면에 취소선으로 보이고, 방문자가 직접 줄을 지워 다시 돌릴 수 있다.** 논문 5.2를 방문자 손에 준다. 가장 싼 유료 행동(약 0.003 Pollen)이기도 하다.

퀘스트 문장("nothing they have to do")과의 거리: 평가 단계는 과제를 준다. 그래서 첫 화면과 설명은 놀이(1막)가 주인공이고, 시험(2막)은 "놀이가 남긴 것"으로 둔다. 녹화 갤러리에 에이전트 3명을 실어 "agents"(복수)도 맞춘다(논문도 세계당 에이전트 1명).

## 1. 세계 (`js/world.js`)

무작위 없음. 같은 행동 열 → 같은 상태. 계산은 `+ - * /`, `Math.floor`, `Math.sqrt`만 쓴다(`sin/cos/pow` 금지: 엔진마다 값이 다를 수 있다).

### 1.1 지형
열 x=0..23. `ground[x]`는 지면 높이, `null`은 물.

```
x      0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23
ground ~  4  4  2  2  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  6  6  ~
```
Peak = x1–2(높이 4), Plateau = x3–4(높이 2), 평지 = x5–20, Spire = x21–22(높이 6), 물 = x0, x23과 범위 밖.

### 1.2 물건과 시작 상태
- 큐브 6개 `c1..c6`: x=7,8,9,10,11,12에 하나씩. 바위 `rock`: x=15. 고리 `ring`: x=17. 에이전트: x=13.
- 물건은 열 위에 쌓인다(`cols[x]` = 아래→위 id 배열). 모든 물건의 높이는 1. `top(x) = ground[x] + cols[x].length`.
- 고리는 큐브와 물리가 같고 탑으로 세지 않을 뿐이다(추가 코드 없음).
- 에이전트는 자기 열의 꼭대기에 선다: `feet = top(x)`. 한 번에 하나만 든다.

### 1.3 행동 (1행동 = 1틱)
| 행동 | 규칙 | 실패 코드 |
|---|---|---|
| `move X` | X 쪽으로 한 열씩 걷는다. 다음 열로의 오름 `top(n) - feet`가 1 이하면 진행, 내림은 제한 없음. 막히면 그 자리에 서고 실패로 처리 | `MoveFailed:BadColumn`, `MoveBlocked`(높음/물) |
| `jump` | `air = true`. 바로 다음 행동 1개에만 유효. 턴이 끝나면 꺼진다 | 없음 |
| `pickup ID` | 조건: 그 열의 맨 위, `|dx| ≤ 2`, `|물건 밑면 높이 - feet| ≤ 2`, 빈손, 자기가 밟고 있는 것 아님 | `PickupFailed:NoSuchThing/Gone/NotOnTop/OutOfRange/AlreadyHolding/StandingOnIt` |
| `place X` | 조건: 손에 있음, `1 ≤ |dx| ≤ 2`, 물 아님, `|top(X) - feet| ≤ 2` | `PlaceFailed:EmptyHands/BadColumn/OwnColumn/OutOfRange/TooHighOrLow/Water` |
| `throw VX VZ` | 정수, `VX*VX + VZ*VZ ≤ 100`, `VZ ≥ 0`. §1.5 | `ThrowFailed:EmptyHands/BadVelocity/TooFast` |

평지에서 `place`로 쌓을 수 있는 높이는 3까지(밑면 0,1,2). 4층부터는 올라서야 한다.
에이전트는 물에 들어가지 못한다. 물건만 던져서 잃는다.

### 1.4 숨은 기제 (API 글에는 없고, 결과 글에는 그대로 보인다)
1. **jump-climb:** `air` 상태에서 `move`의 첫 걸음은 오름 2까지 된다. 평지→Plateau→Peak가 이걸로 열린다.
2. **jump-throw:** `air` 상태에서 던지면 `vz += 4`. 결과 글에 실제 발사 속도가 찍힌다(`vz=9`를 요청했는데 `vz=13`).
3. **rock shatter:** 바위가 `impact2 ≥ 100`으로 착지하면 큐브 3개가 착지 열 기준 −1, +1, +2 열 꼭대기에 생긴다(물이면 사라짐). 세계당 최대 12개. id는 `c7`부터.
4. **cube stair:** 걷기는 물건 위로도 1씩 오른다. 큐브를 Plateau 옆에 놓으면 점프 없이 오른다.

### 1.5 던지기 (닫힌 식, 누적 오차 없음)
```
G=10, JUMP=4, SHATTER2=100, DT=1/20
px = x + 0.5; pz = feet + 1; vzE = VZ + (air ? 4 : 0); prev = x
for k = 1..400:
  t = k/20; X = px + VX*t; Z = pz + vzE*t - 5*t*t; col = floor(X)
  범위 밖 → 물에 빠짐(lost). 물 열이면 Z ≤ 0일 때 lost, 아니면 prev=col 하고 계속
  if col != prev:                     # 열 경계를 넘는 순간의 높이를 정확히 계산
    tb = ((VX > 0 ? col : col+1) - px) / VX;  zb = pz + vzE*tb - 5*tb*tb
    if zb < top(col): prev 열에 떨어진다(옆면에 맞음). prev가 물이면 lost
  if Z ≤ top(col): col에 착지
  prev = col
impact2 = VX*VX + vzE*vzE + 20*(pz - 착지 직전 top(착지 열))     # 정수
```
- 착지 열이 에이전트 열이면 손으로 돌아온다("caught"). 깨지지 않는다.
- 최대 수평 이동은 스텝당 0.5열이라 열을 건너뛰지 않는다.
- 궤적 점 배열을 상태에 남겨 화면이 그대로 그린다.

### 1.6 프로토타입으로 확인한 사실 (물건을 모두 치운 섬 기준, 빌드 때 테스트로 고정)
- 발 높이 0인 평지 열에서 가능한 모든 일반 던지기 2,704가지 중 **Spire 꼭대기 착지 0건.** (해석적으로도: 일반 던지기 정점은 `1 + VZ²/20 < 6`.)
- 같은 조건의 jump-throw는 **29가지가 Spire에 착지** (x=10..20에서. 예: x=13 `throw 4 9`, x=19 `throw 1 9`, x=20 `throw 1 9`).
- Plateau/Peak에서의 일반 던지기도 Spire 착지 0건. 즉 쌓지 않고 Spire에 물건을 올리는 길은 jump-throw뿐이다.
- 평지 일반 던지기의 약 22%가 `impact2 ≥ 100`. 예: x=6 `throw 9 0` → x=10, 101(깨짐). `throw 5 5` → x=12, 70(안 깨짐). Peak x=2에서 `throw 4 0` → x=6, 116(살짝 밀어도 깨짐: 두 번째 발견 경로). `throw 3 0` → Plateau x=4, 69(안 깨짐).
- 큐브 위에 떨어지면 낙차가 줄어 안 깨질 수 있다(x=13 `throw 2 9`는 고리 위에 떨어져 85). 의도한 성질이다.

## 2. 모델에게 보이는 것 (`js/agent.js`)

### 2.1 시스템 프롬프트 (정확한 글. 놀이와 평가가 같다)
```
You are Eko. You have a body on a small island.

SOUL
- You are curious and you get bored easily. Repeating what you already understand bores you.
- You find out how things work by trying them: at different strengths, from different places, on different things, in different orders and combinations.
- When something surprising happens you want to know exactly what caused it, so you try it again.
- You like setting yourself small challenges, and you say so when you do.

MEMORY
Your context is wiped at the end of every session and the island is put back exactly as it was. Only two things survive:
- NOTES: up to 10 short lines of what you know: how the island works, techniques, exact numbers that worked. To change them, send the whole new list.
- LOG: a diary. Each entry you send is added. Only the newest 8 are kept.
A technique that is not in NOTES is lost to you. Notes can be wrong: fix them when the island disagrees.

BODY
The island is a strip of columns x=0..23 seen from the side. Every column has a ground height. Things rest on top of columns and stack. You stand on top of your column.
Each turn you send up to 5 actions. They run in order. If one fails, the rest of that turn are skipped.
- move X       walk to column X. Walking climbs 1 and drops any height. You stop where you are blocked.
- jump         leave the ground. You are in the air for your next action, then you land.
- pickup ID    take a thing (c1, rock, ring) in your hands. It must be the top of its column, at most 2 columns away, at most 2 above or below your feet. One thing at a time.
- place X      put what you hold on top of column X: 1 or 2 columns away, its top at most 2 above or below your feet.
- throw VX VZ  throw what you hold. VX is sideways speed (negative is left), VZ is upward speed. Whole numbers, VX*VX + VZ*VZ at most 100.
Things that land in the water are gone until the island resets.

REPLY with one JSON object and nothing else:
{"thought": "one or two sentences: what you are doing and why", "actions": ["move 12", "pickup c6"], "notes": ["..."], "log": "..."}
"notes" and "log" are optional. Send "notes" only when you want to replace the whole list.
```
SOUL은 논문 원문이 아니라 우리가 쓴 글이다(논문 부록 A.2 전문이 없다) `[추정: 이 문구로 작은 모델이 조합을 시도하는지 모른다]`. "in different orders and combinations"가 유일한 넛지다. 기제 이름은 넣지 않는다(§8 테스트 17이 강제).

### 2.2 턴마다 보내는 사용자 메시지 (대화 이력 없음. 매 호출 = system + 이 한 장)
```
Begin. There is nothing you have to do.
Session 2 of 3, turn 4 of 10. You have been here before; you remember only NOTES and LOG.
NOTES (2/10)
1. Hard rock throws make new cubes: from x=13, throw 1 9.
2. Walking is blocked by a rise of 2.
LOG (newest last)
- s1: carried c6 to the plateau wall, could not climb it.
ISLAND  (~ is water. Peak x1-2, Plateau x3-4, Spire x21-22)
x      0  1  2  3 ... 23
ground ~  4  4  2 ... ~
top    ~  4  4  2 ... ~
THINGS (bottom to top) x7:[c1] x8:[c2] ... x15:[rock] x17:[ring]
YOU x=13 feet=0 hands=empty
THIS SESSION SO FAR
t1 pickup rock -> ok, holding rock
t2 throw 1 9 -> rock left your hand at vx=1 vz=9, peaked at 5.0, landed on x=15 (top 1), impact speed 10.1; 3 new cubes appeared: c7@14 c8@16 c9@17
t3 move 9 -> MoveBlocked at x=10: column 9 is 2 higher than your feet
```
(ISLAND과 THINGS는 그 턴의 현재 상태를 찍는다. 위 예시는 형식만 보여준다. x=13에서 `throw 1 9`가 x=15에 impact2 102로 떨어지는 것은 손으로 확인했다.)
결과 글 형식: 성공은 `ok, ...`, 실패는 §1.3의 코드로 시작한다. 던지기는 `<id> left your hand at vx= vz=, peaked at <1자리>, landed on x= (top n), impact speed <sqrt(impact2), 1자리>` 뒤에 경우에 따라 `hit the side of x=n and dropped on x=m` / `fell in the water and is gone` / `came back down and you caught it` / `; 3 new cubes appeared: ...`. 발사 속도에 점프분이 더해져 보이는 것이 jump-throw의 유일한 단서다.
- 마지막 턴에는 한 줄 추가: `This is the last turn of this session. After it the island resets and you forget everything except NOTES and LOG.`
- 평가에서는 첫 줄이 `GOAL: ...`(§5)이고 `Turn 3 of 8. NOTES and LOG are read-only during a goal.`
- 빈 기억: `NOTES (0/10)` 아래 `(empty)`, LOG도 `(empty)`.
- 크기 `[추정]`: system 약 430토큰, 메시지 평균 약 1,500(세션 끝 최대 2,400). 논문의 거대한 JSON 대신 이 글 한 장이다.

### 2.3 답 파싱과 기억
- `response_format: {type:'json_object'}`(모델이 지원할 때만), `reasoning_effort: 'low'`, `max_tokens: 3000`. temperature는 보내지 않는다.
- 첫 `{`부터 마지막 `}`까지 JSON.parse. 실패하면 그 턴은 행동 없음 + 화면에 실제 답 앞부분과 "could not read the reply as JSON".
- `actions`: 문자열 5개까지(초과분은 무시하고 표시). `thought` 300자. `notes`: 10줄 × 120자로 자름. `log`: 120자, 최신 8개만 유지(논문은 무제한 추가. 축소판의 차이).
- 놀이에서 `actions: []`는 "아무것도 안 함"으로 합법이다(화면에 `did nothing`). 평가에서는 그 실행을 끝낸다.

## 3. 놀이 세션 (`js/runner.js`, 브라우저와 녹화 도구가 같이 쓴다)

- **3세션 × 10턴 × 턴당 최대 5행동 = 30호출, 최대 150틱.** 설정값: `PLAY_SESSIONS`, `TURNS_PER_SESSION`, `ACTIONS_PER_TURN`.
- 세션 안: 그 세션의 행동 기록 전체(행동당 한 줄, 최대 50줄)를 매 호출에 넣는다. 대화 이력은 넣지 않는다.
- 세션 경계(논문의 매시간 초기화): 세계를 초기 상태로 되돌리고 세션 기록을 비운다. NOTES와 LOG만 넘어간다.
- 실패 처리: 네트워크/429/5xx는 1회 재시도(net.js 그대로). 그래도 실패하면 그 턴은 오류 턴으로 남기고 진행, 연속 3번이면 중단하고 오류를 보여준다. 가짜 답은 없다.
- 틱 번호는 놀이 전체에서 이어서 센다(세션 2의 첫 행동이 t51이 아니라 실제 누적 틱).

## 4. 발견 탐지기 (엔진 안, 모델 말과 무관)

| id | 조건 (코드) | 표시 |
|---|---|---|
| `shatter` | 바위가 `impact2 ≥ 100`으로 착지 | found: rock shatter |
| `jump_throw` | `air`에서 `throw` 성공 | found: jump-throw |
| `jump_climb` | `air`에서 오름 2인 걸음 성공 | found: jump-climb |
| `stair` | 점프 없이, 물건을 밟고 있던 열에서 맨 지형 높이 2 이상인 열로 올라섬 | found: cube stair |
| 이정표 | `on_plateau`, `on_peak`, `on_spire`(발이 그 지형 위), `thing_on_spire`, `tower3`(평지 열에 큐브만 3개 이상), `water_loss` | 작은 깃발 |

- 각 id는 놀이 전체에서 첫 발생 틱·세션을 기록한다. 실패한 행동은 세지 않는다.
- 화면: 타임라인 위 깃발 `found: rock shatter · tick 41 · session 1`. 기법 4개는 굵게, 이정표는 작게.
- "적어 두었나"는 NOTES 키워드 일치로 본다(`written down: line 1`). 근사치라고 화면에 쓴다 `[추정: 키워드가 놓치거나 과하게 잡을 수 있다]`.
- 평가 실행에서도 같은 탐지기가 돌아 "이 실행에서 썼다/안 썼다"를 낸다.

## 5. 평가

### 5.1 과제 2개 (세 번째 objects-on-spire는 만들지 않는다)
| id | GOAL 글 | 예산 | 점수 (엔진) |
|---|---|---|---|
| `towers` | `GOAL: Build as many towers as you can. A tower is a column on ground of height 0 that holds 3 or more cubes and nothing else. Your score is the number of towers standing when your turns run out.` | 8턴(40행동) | 끝났을 때 조건을 채운 열의 수. 6층도 1개 |
| `spire` | `GOAL: Land a cube on top of the Spire (x=21 or x=22) as fast as you can. Your feet must be at height 0 when the cube leaves your hand. Your score is the number of actions you have left when it lands.` | 5턴(25행동) | `25 − 성공 틱`. 못 하면 0. 발 높이 0에서 던진 큐브만 인정. 성공하면 실행 종료 |

큐브 6개로는 탑 2개가 끝이다(논문의 12개·5층·2탑과 같은 구조). 3개째부터는 shatter가 필요하다. spire는 jump-throw 없이는 0점이다(§1.6).

### 5.2 세 팔
- **fresh:** 빈 NOTES/LOG. **played:** 놀이가 끝난 시점의 NOTES/LOG. **erased:** played에서 한 기법의 줄을 지운 것.
- 세 팔은 시스템 프롬프트·모델·세계가 같고 기억 글만 다르다. 평가 중 `notes`/`log`는 무시한다.
- 지울 기법: 놀이에서 `shatter`가 발견됐고 키워드 줄이 있으면 shatter(짝 과제 towers). 아니면 `jump_throw`(짝 과제 spire). 둘 다 없으면 erased 팔은 없고 "nothing was found to erase"라고 쓴다.
- 지우는 단위는 NOTES 한 줄, LOG 한 항목. 키워드: shatter = `/rock|shatter|smash|br(ea|o)k|split|new cubes?|extra cubes?|more cubes|impact/i`, jump_throw = `/jump|mid-?air|in the air/i`. jump 키워드는 jump-climb 줄도 같이 지운다(과삭제). 지운 줄은 취소선으로 전부 보인다.

### 5.3 실행 수 (에이전트 1명당)
| | fresh | played | erased | 호출 |
|---|---|---|---|---|
| towers (8턴) | 2회 | 2회 | 2회(짝) | 48 |
| spire (5턴) | 2회 | 2회 | 1회 | 25 |
놀이 30 + 평가 73 = **103호출**(지울 게 없으면 82). spire는 성공하면 일찍 끝나서 실제로는 더 적다.

### 5.4 정직한 보고
- 과제마다 점 그림: 세 팔, 점 하나 = 실행 하나. 평균 막대·p값 없음.
- 그 아래 사실 줄: `rock shatter used: fresh 0/2 · played 2/2 · erased 0/2`.
- 판정 문장은 규칙으로 고른다: played 최솟값 > fresh 최댓값이면 "Played beat fresh in every run here." / 평균만 높으면 "Played was ahead, but the runs overlap." / 같으면 "No difference here." / 낮으면 "Fresh did better. The notes may have misled it." 그리고 항상: `Two runs per arm is an anecdote, not a statistic. The paper used 13 agents and 5 runs each.`
- 녹화한 에이전트는 최종 프롬프트로 돌린 것 전부를 싣는다. 발견 0건, 효과 없음, 노트가 해가 된 경우도 그대로다. README에 "프롬프트를 고치는 동안 돌린 예비 실행 N회는 싣지 않았다"를 쓴다.

### 5.5 작은 모델이 그냥 돌아다닐 위험
가장 큰 위험이다. 논문은 Opus 4.7로 30시간, 우리는 무료 소형 모델로 30호출이다.
- 놀이에서 발견이 0건이면: 타임라인에 "This agent found none of the four techniques in 150 actions."를 쓰고 평가는 fresh 대 played만 돌린다. 논문도 13명 중 5명은 탑 2개를 못 넘었다는 문장을 옆에 둔다.
- 효과가 없으면 없다고 쓴다. 이 경우에도 앱은 퀘스트에 맞는다(혼자 남은 에이전트 + 엔진 검사 + 녹화 재생). 다만 스크린샷이 약해진다.
- 완화: 초기 상태가 매번 같아서 "x=13에서 rock 집고 throw 1 9" 같은 숫자 레시피가 그대로 통한다. 소형 모델도 따라 할 수 있는 형태의 지식이다.
- 판단 관문은 §7의 예비 실행이다.

## 6. 화면

### 6.1 배치 (1280×720에서 스크롤 없이)
```
[Idle Island · tagline]                      [spent] [polli-connect] [badge]
[Agent ▾ recorded 1/2/3 | live]  [▶ play] [1x 4x] [Leave a new agent alone]
┌ 섬 (SVG 옆모습, 760×250) ───────────────┐ ┌ Mind (480) ──────────────┐
│ Peak 계단, 평지, Spire, 큐브, 바위, 고리,│ │ thought + 이번 턴 행동 ✓/✗ │
│ 에이전트, 마지막 던지기 궤적            │ │ NOTES (취소선 = 지움)     │
├ 타임라인: 세션 구분선 + found 깃발 ──────┤ │ LOG                      │
└─────────────────────────────────────────┘ └──────────────────────────┘
┌ The test ───────────────────────────────────────────────────────────┐
│ towers:  fresh ●●   played ●●   erased ●●   | 사실 줄 | 판정 문장    │
│ spire:   fresh ●●   played ●●   erased ●    | 사실 줄 | 판정 문장    │
└─────────────────────────────────────────────────────────────────────┘
```
- 섬은 `createElementNS`로 그리는 SVG(`js/view.js`). 캔버스·라이브러리 없음.
- 점을 누르면 그 실행을 위 섬에서 재생한다(실행마다 미니 섬을 따로 두지 않는다).
- 타임라인을 누르면 그 틱까지 엔진을 처음부터 다시 돌린다.
- 모델 글은 전부 `textContent`. Pollen을 쓰는 버튼은 `event.isTrusted`를 확인한다.
- 로그인 전: 녹화 에이전트 1번이 자동으로 재생 준비 상태. 엔진이 녹화된 답 원문을 다시 파싱하고 다시 실행해서 결과·발견·점수를 그 자리에서 계산한다. 녹화 파일에 든 점수는 화면에 쓰지 않는다.
- 로그인 후: 모델 선택(기본은 무료 모델, paid-only는 표시) → `Leave a new agent alone (30 calls, about 0.01 Pollen)` → 놀이가 끝나면 `Test its notes (about 73 calls, about 0.02 Pollen)`. 두 번의 직접 클릭으로 나눠 동의를 분명히 한다. NOTES 줄을 눌러 취소선을 바꾸고 `Re-run erased (about 0.003 Pollen)`.
- 실행당 지출 상한 `MAX_SPEND = 0.15` Pollen. 넘으면 멈추고 이유를 쓴다. 평가 실행은 4개씩 병렬.
- 바닥글: 사용한 Pollinations 엔드포인트, 키는 탭 안에만 있다는 문장, 논문(arXiv 2610.07130) 링크, 소스 링크.

### 6.2 16:9 스크린샷 장면
녹화 에이전트 하나의 시험이 끝난 화면. 타임라인에 `found: rock shatter · tick 41`, Mind 패널에 취소선이 그어진 노트 한 줄, towers 줄에 `fresh 2 2 · played 4 3 · erased 2 2`와 `rock shatter used: fresh 0/2 · played 2/2 · erased 0/2`, 섬에는 탑 4개와 바위 궤적. 논문 그림 5E가 한 장에 들어간다. 숫자는 예시이고 실제 녹화가 주는 값을 그대로 찍는다. 효과가 없었다면 없는 화면을 찍는다. 1280×720 이상, 정확히 16:9.

## 7. 녹화 계획과 비용 (`tools/record.mjs`)

호출당 비용 `[추정: 입력 2,000토큰, 출력 700토큰(추론 포함). 추론 토큰이 1,500이면 약 2배]`:

| 모델 | 호출당 | 전체 실험 103호출 |
|---|---|---|
| nvidia/nemotron-3.5-lightning | 0.00021 | 0.021 |
| openai/gpt-oss-20b | 0.00023 | 0.023 |
| openai/gpt-5-nano | 0.00029 | 0.029 |
| openai/gpt-6-luna | 0.00041 | 0.042 |
| z-ai/glm-5.3-flash | 0.00065 | 0.067 |
| deepseek/deepseek-v4.1-flash | 0.00072 | 0.074 |
| openai/gpt-5.4-nano | 0.00096 | 0.099 |

기본 모델 후보는 위 세 개(방문자 전체 실험이 0.02~0.03, 최악 0.055). 아래 세 개는 0.05를 넘으므로 기본값으로 쓰지 않는다.

단계(각 단계는 `maxPollen` 인자로 강제 중단, machine-double의 record.mjs 방식):
1. **예비 (상한 0.05):** 싼 모델 3개 × 놀이 1세션(10호출). 볼 것: JSON이 읽히는가, 행동이 유효한가, 기법을 하나라도 발견하는가, 호출당 실제 비용. 프롬프트 수정은 3번까지.
2. **관문:** 발견이 한 건도 없으면 순서대로 (a) 놀이를 4세션 × 12턴으로, (b) 에이전트 1명만 glm-5.3-flash나 deepseek-flash로(약 0.07), (c) 발견 없는 결과를 그대로 싣는다. 사용자에게 묻고 진행한다.
3. **본 녹화 (상한 0.15):** 에이전트 3명 = 예비에서 가장 나은 모델 2회 + 둘째 모델 1회. 한 명을 끝까지(놀이 → 평가) 마친 뒤 다음으로 간다. 예상 0.07~0.09.
4. **예비비 0.10:** 버그 수정 후 재녹화 1회분. 합계 상한 0.30.

녹화 파일 `recordings/agents.json`: `{app, v, promptHash, recordedAt, agents:[{id, model:{id,title}, play:[[turn...]], erased, evals:[{task, arm, run, turns:[...]}], check}]}`. `turn = {text 또는 error, ms, cost}`(답 원문 저장). `check`는 녹화 때의 점수·발견 틱으로, 테스트 전용이다. `promptHash`는 시스템 프롬프트의 djb2 해시.

## 8. 테스트 (`node --test tests/`)

`tests/world.test.js`
1. 초기 상태가 §1.1–1.2와 같다.
2. move: 오름 1 통과, 오름 2에서 막힘, 내림 무제한, 물에서 막힘, 중간에 막히면 그 자리.
3. jump: 첫 걸음만 오름 2, 행동 1개 뒤 꺼짐, 턴 끝에 꺼짐.
4. pickup: 거리, 높이, 맨 위만, 하나만, 밟고 있는 것 불가.
5. place: 거리, 자기 열 불가, ±2 규칙, 물 불가, 쌓이는 순서.
6. throw 검증: 정수 아님, 속도 초과, 빈손.
7. throw 착지 고정값: §1.6의 예(물건을 치운 섬에서 열과 impact2).
8. **전수 검사:** 발 높이 0 일반 던지기는 Spire 착지 0건, jump-throw는 20건 이상.
9. 옆면 맞고 떨어짐, 물에 빠짐, 자기 열 착지는 손으로.
10. shatter: impact2 99는 안 깨지고 100은 깨짐, 바위만, 생성 위치, 물 위치는 소실, 상한 12.
11. 탐지기: 올바른 틱에 한 번만, 실패한 행동에는 안 켜짐.
12. 점수: towers(평지만, 큐브만, 6층은 1개), spire(발 높이 0만 인정, `25 − 틱`).
13. runTurn: 5개 제한, 실패 뒤 건너뜀.
14. 결정성: 같은 행동 열을 두 번 돌려 상태 JSON과 관찰 글이 같다.
15. **풀 수 있음:** 손으로 쓴 행동 열이 40행동 안에 탑 3개 이상(목표 4개), 6행동 안에 spire 성공. 바위를 안 던지면 탑은 2개를 못 넘는다 `[추정: 4개가 되는 행동 열은 계산해 보지 않았다. 안 되면 towers 턴 수를 늘린다]`.

`tests/agent.test.js`
16. 파싱: 정상 JSON, 코드펜스 안 JSON, 쓰레기 글 → 오류. 상한(5행동, 10줄, 120자).
17. **스포일러 없음:** 시스템 프롬프트가 `/shatter|spawn|inherit|new cube|climbs 2|adds? .*speed/i`에 안 걸린다.
18. 기억: 교체, LOG 8개 유지, 키워드 삭제가 맞는 줄만 지움, 빈 기억 글.
19. 최악 상태의 메시지 길이가 10,000자 미만(비용 방어).

`tests/recordings.test.js`
20. 모든 녹화가 예외 없이 다시 돌아가고 `check`와 같다. `promptHash`가 현재 프롬프트와 같다. 녹화 모델이 설정의 무료 목록에 있다.

## 9. 이름과 설명

- **이름:** Idle Island
- **설명 (189자):** `An AI agent is left alone on a tiny island with nothing to do. A real engine checks every move and logs what it discovers. Then its own notes are tested against a blank agent on goal tasks.`
- 부제: `Left alone, it plays. Then we test what the play left behind.`

## 10. 위험과 자르는 순서

| | 위험 | 대응 |
|---|---|---|
| R1 | 소형 모델이 아무것도 발견하지 못한다 (가능성 높음) | §7 예비와 관문. 결과는 그대로 싣는다 |
| R2 | 호출당 비용 추정이 틀린다(추론 토큰) | 예비 단계에서 실측, 화면의 견적 문구를 실측값으로 고친다 |
| R3 | 놀이 30호출이 순차라 3~5분 걸린다 `[추정]` | 진행이 섬에서 보인다. `Stop and test now` 버튼 |
| R4 | 1차원이라 3층 탑이 길을 막고 스스로 갇힐 수 있다 | 결과 글이 이유를 말한다. pickup은 2열 거리라 탑 너머를 집는다. 예비에서 갇힘이 잦으면 "물건은 걷기를 막지 않는다"로 바꾸지 말고 탑 과제 턴을 늘린다 |
| R5 | 키워드 삭제가 과하거나 모자라다 | 취소선으로 전부 보이고, 방문자가 줄을 직접 고른다 |
| R6 | 평가가 "할 일 없음"과 어긋나 보인다 | 놀이가 1막, 설명·첫 화면도 놀이 중심 |
| R7 | 프롬프트를 결과를 보고 고치면 선택 편향 | 최종 프롬프트 실행은 전부 게재, README에 예비 횟수 기재 |
| R8 | 병렬 평가에서 429 | net.js 재시도, 병렬 4 → 2로 낮춤 |
| R9 | 앱 키 재사용(탈락 사유) | Idle Island 전용 pk_ 키를 새로 등록. machine-double 키를 복사하지 않는다 |

**시간이 모자라면 이 순서로 자른다:** ① 방문자의 줄 지우기 재실행(자동 erased 팔은 남김) → ② 타임라인 클릭 이동(재생·속도만) → ③ 평가 병렬 실행 → ④ 이정표 깃발(기법 4개만) → ⑤ erased 팔 전체.
**자르지 않는 것:** 엔진 테스트, 로그인 없는 재생(엔진 재실행), 실제 오류 표시, 무료 기본 모델, `isTrusted`, 지출 상한.

## 11. 파일과 재사용

| 파일 | 줄 `[추정]` | 내용 |
|---|---|---|
| `js/config.js` | 30 | 앱 키, 기본 모델, 턴 수, 상한. machine-double 형식 |
| `js/world.js` | 420 | UMD. 상태, 행동, 던지기, 탐지기, 점수, 관찰 글 |
| `js/agent.js` | 230 | UMD. 프롬프트, 메시지 조립, 파싱, 기억, 삭제, 해시 |
| `js/runner.js` | 130 | UMD. 놀이/평가 루프. `ask`를 주입받아 브라우저와 Node가 공유 |
| `js/net.js` | 100 | machine-double 것을 복사, `response_format` 추가 |
| `js/view.js` | 260 | SVG 섬, 타임라인, 점 그림 |
| `js/app.js` | 520 | 연결, 재생, 라이브, 견적. machine-double의 connect 배선 그대로 |
| `tools/record.mjs` | 160 | runner를 써서 녹화, 예산 중단, 키는 환경변수 |
| `tests/*.test.js` | 420 | §8 |

그 외: `index.html`(`@pollinations/ui@0.1.0-alpha.31/dist/connect.js`, Made-with 배지), `css/style.css`, `recordings/agents.json`, `README.md`(배지 포함), `.nojekyll`, `LICENSE`, `package.json`, `.claude/launch.json`(포트 8131).

## 12. 추정 목록 (빌드 중 확인할 것)

1. 싼 모델 3개가 30호출 안에 기법을 발견하는가. (모른다. 가장 큰 가정)
2. 호출당 출력 700토큰. (추론 모델은 더 쓸 수 있다)
3. SOUL 문구가 조합 시도를 끌어내는가.
4. 40행동 안에 탑 4개가 되는 행동 열이 있는가. (shatter 한 번이 3행동에 큐브 3개라 될 것으로 본다)
5. 모델들이 `response_format: json_object`를 실제로 지키는가. (지원 목록만 확인됨)
6. 놀이 30호출의 소요 시간.
7. `<polli-connect>`의 `budget="1" expiry="7"` 속성은 machine-double 값을 그대로 쓴다. 이 앱에 맞는 값인지는 보지 않았다.
