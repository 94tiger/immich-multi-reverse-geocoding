const fs = require('fs');

function stripBom(text) {
  return text.replace(/^\uFEFF/, '');
}

function looksMojibake(text) {
  if (!text) return false;
  return /[�ÃÐ¢]/.test(text);
}

try {
    const raw = fs.readFileSync('./mapping.csv', 'utf8');
    const csv = stripBom(raw);
    const lines = csv.split(/\r?\n/);

    // 글로벌 해역 및 특수 지명 수동 매핑
    const mapping = {
      'Yellow Sea': '서해', 'West Sea': '서해',
      'East Sea': '동해', 'Sea of Japan': '동해',
      'South Sea': '남해', 'East China Sea': '남해',
      'Korea Strait': '대한해협', 'Jeju Strait': '제주해협',
      'Pacific Ocean': '태평양', 'Liancourt Rocks': '독도'
    };

    let suspiciousCount = 0;

    for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(',');
        if (cols.length < 8) continue;

        const sido = cols[2] ? cols[2].replace(/"/g, '').trim() : '';
        const sigungu = cols[4] ? cols[4].replace(/"/g, '').trim() : '';
        const dong = cols[6] ? cols[6].replace(/"/g, '').trim() : '';
        let engName = cols[7] ? cols[7].replace(/"/g, '').trim() : '';

        if (!engName || engName === '영문 표기') continue;

        engName = engName.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
        const targetKor = dong || sigungu || sido;

        if (looksMojibake(targetKor)) {
            suspiciousCount++;
            continue;
        }

        if (!mapping[engName]) {
            mapping[engName] = targetKor;
        }

        const cleanEng = engName.replace(/-(do|si|gun|gu|eup|myeon|dong|ri)$/i, '').trim();
        if (cleanEng && cleanEng !== engName && !mapping[cleanEng]) {
            mapping[cleanEng] = targetKor;
        }
    }

    fs.writeFileSync('./mapping.json', JSON.stringify(mapping, null, 2), 'utf8');
    console.log(`✅ [생성 완료] 총 ${Object.keys(mapping).length}개의 지명 매핑 사전(mapping.json)이 준비되었습니다.`);

    if (suspiciousCount > 0) {
        console.warn(`⚠️ [경고] 한글 깨짐이 의심되는 행 ${suspiciousCount}건을 건너뛰었습니다.`);
        console.warn('⚠️ mapping.csv 인코딩이 UTF-8이 아닐 수 있습니다. CP949/EUC-KR 원본이면 UTF-8로 변환 후 다시 생성해 보세요.');
    }

} catch (err) {
    console.error('❌ [오류] mapping.csv 파일을 읽을 수 없습니다.', err.message);
}
