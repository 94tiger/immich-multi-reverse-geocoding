const fs = require('fs');

try {
    const csv = fs.readFileSync('./mapping.csv', 'utf8');
    const lines = csv.split(/\r?\n/);
    
    // 글로벌 해역 및 특수 지명 수동 매핑
    const mapping = {
      "Yellow Sea": "서해", "West Sea": "서해",
      "East Sea": "동해", "Sea of Japan": "동해",
      "South Sea": "남해", "East China Sea": "남해",
      "Korea Strait": "대한해협", "Jeju Strait": "제주해협",
      "Pacific Ocean": "태평양", "Liancourt Rocks": "독도"
    };

    for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // CSV 콤마 분리 (따옴표 처리 등 예외 방어)
        const cols = line.split(',');
        if (cols.length < 8) continue;
        
        const sido = cols[2] ? cols[2].replace(/"/g, '').trim() : '';
        const sigungu = cols[4] ? cols[4].replace(/"/g, '').trim() : '';
        const dong = cols[6] ? cols[6].replace(/"/g, '').trim() : '';
        let engName = cols[7] ? cols[7].replace(/"/g, '').trim() : '';
        
        if (!engName || engName === '영문 표기') continue;
        
        engName = engName.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
        const targetKor = dong || sigungu || sido;

        // 1. 원본 영문명 선점 매핑
        if (!mapping[engName]) {
            mapping[engName] = targetKor;
        }
        
        // 2. OSM 특화 꼬리 자르기 매핑 (-do, -si, -gun, -gu, -eup, -myeon, -dong, -ri)
        const cleanEng = engName.replace(/-(do|si|gun|gu|eup|myeon|dong|ri)$/i, '').trim();
        if (cleanEng && cleanEng !== engName && !mapping[cleanEng]) {
            mapping[cleanEng] = targetKor;
        }
    }

    fs.writeFileSync('./mapping.json', JSON.stringify(mapping, null, 2), 'utf8');
    console.log(`✅ [생성 완료] 총 ${Object.keys(mapping).length}개의 지명 매핑 사전(mapping.json)이 준비되었습니다.`);
    
} catch (err) {
    console.error('❌ [오류]mapping.csv 파일을 읽을 수 없습니다.', err.message);
}
