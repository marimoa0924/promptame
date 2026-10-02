from openpyxl import Workbook, load_workbook
from pathlib import Path
from collections import Counter
import re

# ============================================================
# 주제 데이터
# 필수어는 각 행마다 정확히 3개
# ============================================================

rows = [
    # 쉬움 20
    [1, "비", "우산,장마,빗방울", "쉬움", "생활", "rain,umbrella,monsoon,raindrop"],
    [2, "피자", "치즈,토마토,도우", "쉬움", "음식", "pizza,cheese,tomato,dough"],
    [3, "강아지", "산책,꼬리,후각", "쉬움", "동물", "dog,walk,tail,smell"],
    [4, "자전거", "페달,바퀴,체인", "쉬움", "생활", "bicycle,pedal,wheel,chain"],
    [5, "나무", "뿌리,줄기,나이테", "쉬움", "과학", "tree,root,stem,growth ring"],
    [6, "무지개", "햇빛,프리즘,굴절", "쉬움", "과학", "rainbow,sunlight,prism,refraction"],
    [7, "김치", "발효,배추,고춧가루", "쉬움", "음식", "kimchi,fermentation,cabbage,red pepper powder"],
    [8, "고양이", "수염,발톱,야행성", "쉬움", "동물", "cat,whisker,claw,nocturnal"],
    [9, "도서관", "대출,서가,열람", "쉬움", "문화예술", "library,loan,bookshelf,reading"],
    [10, "축구", "골키퍼,드리블,패스", "쉬움", "문화예술", "soccer,goalkeeper,dribble,pass"],
    [11, "버스", "정류장,승객,노선", "쉬움", "생활", "bus,bus stop,passenger,route"],
    [12, "아이스크림", "냉동,우유,당분", "쉬움", "음식", "ice cream,frozen,milk,sugar"],
    [13, "나비", "애벌레,날개,번데기", "쉬움", "동물", "butterfly,caterpillar,wing,chrysalis"],
    [14, "달", "위성,지구,궤도", "쉬움", "과학", "moon,satellite,moonlight,orbit"],
    [15, "한글", "자음,모음,음절", "쉬움", "문화예술", "Hangul,consonant,vowel,syllable"],
    [16, "시장", "상인,흥정,물건", "쉬움", "사회", "market,merchant,price,goods"],
    [17, "지도", "축척,방위,기호", "쉬움", "사회", "map,scale,direction,symbol"],
    [18, "사진", "촬영,카메라,구도", "쉬움", "문화예술", "photograph,photography,camera,composition"],
    [19, "컴퓨터", "키보드,마우스,화면", "쉬움", "정보기술", "computer,keyboard,mouse,screen"],
    [20, "우유", "칼슘,단백질,지방", "쉬움", "음식", "milk,calcium,protein,fat"],

    # 보통 20
    [21, "광합성", "엽록체,포도당,산소", "보통", "과학", "photosynthesis,chloroplast,glucose,oxygen"],
    [22, "미토콘드리아", "세포호흡,에너지,호흡", "보통", "과학", "mitochondria,cellular respiration,energy,respiration"],
    [23, "증발", "수증기,온도,기화", "보통", "과학", "evaporation,water vapor,temperature,vaporization"],
    [24, "지진", "진앙,진원,진동", "보통", "과학", "earthquake,epicenter,focus,seismic wave"],
    [25, "화산", "마그마,용암,분화", "보통", "과학", "volcano,magma,lava,eruption"],
    [26, "생태계", "먹이사슬,생산자,분해자", "보통", "과학", "ecosystem,food chain,producer,decomposer"],
    [27, "민주주의", "다수결,선거,시민", "보통", "사회", "democracy,majority rule,election,citizen"],
    [28, "시장경제", "수요,공급,가격", "보통", "사회", "market economy,demand,supply,price"],
    [29, "인구", "출생률,사망률,고령화", "보통", "사회", "population,birth rate,death rate,aging"],
    [30, "산업혁명", "증기기관,공장,기계화", "보통", "역사", "Industrial Revolution,steam engine,factory,mechanization"],
    [31, "조선시대", "훈민정음,한양,과거제", "보통", "역사", "Joseon period,Hunminjeongeum,Hanyang,civil service examination"],
    [32, "고려청자", "상감기법,비색,도자기", "보통", "역사", "Goryeo celadon,inlay technique,jade color,pottery"],
    [33, "소화", "위산,소장,영양소", "보통", "생활", "digestion,gastric acid,small intestine,nutrient"],
    [34, "전기회로", "전압,전류,저항", "보통", "과학", "electric circuit,voltage,current,resistance"],
    [35, "인터넷", "프로토콜,서버,주소", "보통", "정보기술", "internet,protocol,server,address"],
    [36, "인공지능", "학습자료,알고리즘,모델", "보통", "정보기술", "artificial intelligence,training data,algorithm,model"],
    [37, "소설", "서술자,인물,갈등", "보통", "문화예술", "novel,narrator,character,conflict"],
    [38, "판소리", "추임새,소리꾼,고수", "보통", "문화예술", "pansori,interjection,singer,drummer"],
    [39, "떡", "전분,찹쌀,증편", "보통", "음식", "rice cake,starch,glutinous rice,steamed rice cake"],
    [40, "초밥", "식초,생선,와사비", "보통", "음식", "sushi,vinegar,fish,wasabi"],

    # 어려움 20
    [41, "상대성이론", "시공간,중력,광속", "어려움", "과학", "theory of relativity,spacetime,gravity,speed of light"],
    [42, "양자역학", "파동함수,중첩,불확정성", "어려움", "과학", "quantum mechanics,wave function,superposition,uncertainty"],
    [43, "유전학", "대립유전자,유전자형,표현형", "어려움", "과학", "genetics,allele,genotype,phenotype"],
    [44, "면역반응", "항체,항원,면역세포", "어려움", "생활", "immune response,antibody,antigen,immune cell"],
    [45, "신경가소성", "시냅스,학습,신경회로", "어려움", "과학", "neuroplasticity,synapse,learning,neural circuit"],
    [46, "판구조론", "섭입,맨틀,판경계", "어려움", "과학", "plate tectonics,subduction,mantle,plate boundary"],
    [47, "행동경제학", "손실회피,휴리스틱,편향", "어려움", "사회", "behavioral economics,loss aversion,heuristic,bias"],
    [48, "사회계약론", "자연상태,주권,합의", "어려움", "사회", "social contract theory,state of nature,sovereignty,contract"],
    [49, "기회비용", "한계효용,선택,대안", "어려움", "사회", "opportunity cost,marginal utility,choice,alternative"],
    [50, "세계화", "가치사슬,무역,다국적기업", "어려움", "사회", "globalization,value chain,trade,multinational corporation"],
    [51, "르네상스", "인문주의,원근법,고전주의", "어려움", "역사", "Renaissance,humanism,perspective,classicism"],
    [52, "산업유산", "문화재생,보존,재활용", "어려움", "역사", "industrial heritage,cultural regeneration,preservation,reuse"],
    [53, "객체지향프로그래밍", "다형성,상속,캡슐화", "어려움", "정보기술", "object-oriented programming,polymorphism,inheritance,encapsulation"],
    [54, "머신러닝", "과적합,학습데이터,검증", "어려움", "정보기술", "machine learning,overfitting,training data,validation"],
    [55, "데이터베이스", "정규화,테이블,키", "어려움", "정보기술", "database,normalization,table,key"],
    [56, "인상주의", "색채분할,빛,야외회화", "어려움", "문화예술", "Impressionism,color division,light,plein air painting"],
    [57, "화성학", "전조,화음,음정", "어려움", "문화예술", "harmony,modulation,chord,interval"],
    [58, "발효식품", "유산균,미생물,산도", "어려움", "음식", "fermented food,lactic acid bacteria,microorganism,acidity"],
    [59, "분자요리", "구형화,알긴산,질감", "어려움", "음식", "molecular gastronomy,spherification,alginate,texture"],
    [60, "동물행동학", "각인,본능,사회행동", "어려움", "동물", "ethology,imprinting,instinct,social behavior"],
]


# ============================================================
# 분량 데이터
# ============================================================

volume = [
    ["1문장 이내", "문장", 1],
    ["2문장 이내", "문장", 2],
    ["3문장 이내", "문장", 3],
    ["50자 이내", "글자", 50],
    ["100자 이내", "글자", 100],
    ["150자 이내", "글자", 150],
    ["200자 이내", "글자", 200],
    ["300자 이내", "글자", 300],
]


# ============================================================
# 데이터 검증
# ============================================================

# 총 60개
assert len(rows) == 60

# 번호가 1~60인지 확인
assert [r[0] for r in rows] == list(range(1, 61))


# ------------------------------------------------------------
# 난이도별 20개
# ------------------------------------------------------------

difficulty_count = Counter(r[3] for r in rows)

assert difficulty_count["쉬움"] == 20
assert difficulty_count["보통"] == 20
assert difficulty_count["어려움"] == 20


# ------------------------------------------------------------
# 주제 중복 검사
# ------------------------------------------------------------

topics = [r[1] for r in rows]

assert len(topics) == len(set(topics))


# ------------------------------------------------------------
# 필수어 3개 검사
# ------------------------------------------------------------

all_keywords = []

for r in rows:
    kws = r[2].split(",")

    # 각 주제마다 필수어가 정확히 3개인지
    assert len(kws) == 3

    for kw in kws:
        # 필수어는 한글 2~8글자
        assert re.fullmatch(r"[가-힣]{1,8}", kw)

        all_keywords.append(kw)


# ------------------------------------------------------------
# 필수어 전체 중복 검사
# ------------------------------------------------------------

assert len(all_keywords) == len(set(all_keywords))


# ------------------------------------------------------------
# 주제와 필수어가 서로 포함 관계인지 검사
# ------------------------------------------------------------

overlap = []

for r in rows:
    topic = r[1]
    kws = r[2].split(",")

    for kw in kws:
        if topic in kw or kw in topic:
            overlap.append((r[0], topic, kw))

if overlap:
    print("주제-필수어 중복 발견:")
    for x in overlap:
        print(x)

assert not overlap


# ------------------------------------------------------------
# 분류 개수 검사
# ------------------------------------------------------------

categories = [
    "과학",
    "역사",
    "사회",
    "생활",
    "음식",
    "동물",
    "정보기술",
    "문화예술"
]

category_count = Counter(r[4] for r in rows)

for category in categories:
    assert category_count[category] <= 15


# ============================================================
# 엑셀 파일 생성
# ============================================================

wb = Workbook()

# ------------------------------------------------------------
# 주제 시트
# ------------------------------------------------------------

ws = wb.active
ws.title = "주제"

ws.append([
    "번호",
    "주제",
    "필수어",
    "난이도",
    "분류",
    "추가금지어"
])

for r in rows:
    ws.append(r)


# ------------------------------------------------------------
# 분량 시트
# ------------------------------------------------------------

ws2 = wb.create_sheet("분량")

ws2.append([
    "분량이름",
    "기준종류",
    "값"
])

for r in volume:
    ws2.append(r)


# ------------------------------------------------------------
# 꾸밈 없음 / 일반 형식
# ------------------------------------------------------------

for sheet in wb.worksheets:

    # 병합 셀 없음
    assert not sheet.merged_cells.ranges

    for row in sheet.iter_rows():
        for cell in row:
            cell.number_format = "General"


# ============================================================
# 파일 저장
# ============================================================

# Windows 다운로드 폴더에 저장
out = Path(r"C:\Users\soyoon\Downloads\교육용_대전게임_문제데이터.xlsx")

wb.save(out)


# ============================================================
# 저장된 파일 다시 열어서 최종 검증
# ============================================================

check = load_workbook(out, data_only=False)

# 시트 이름 확인
assert check.sheetnames == ["주제", "분량"]


# 주제 시트 크기 확인
assert check["주제"].max_row == 61
assert check["주제"].max_column == 6


# 분량 시트 크기 확인
assert check["분량"].max_row == 9
assert check["분량"].max_column == 3


# 병합 셀 없음 확인
assert not check["주제"].merged_cells.ranges
assert not check["분량"].merged_cells.ranges


# ============================================================
# 최종 결과 출력
# ============================================================

print()
print("========================================")
print("엑셀 파일 생성 완료")
print("========================================")
print("저장 위치:")
print(out)
print()

print("난이도별 개수")
print("쉬움 :", difficulty_count["쉬움"])
print("보통 :", difficulty_count["보통"])
print("어려움 :", difficulty_count["어려움"])
print()

print("필수어 총 개수 :", len(all_keywords))
print("필수어 개수 검사 : 각 주제당 3개")
print("필수어 중복 :", "없음")
print("주제 중복 :", "없음")
print("주제-필수어 겹침 :", "없음")
print()

print("분류별 개수")
for category in categories:
    print(category, ":", category_count[category])

print()
print("========================================")
print("모든 검사를 통과했습니다.")
print("========================================")