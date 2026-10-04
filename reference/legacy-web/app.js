import { db } from './firebase-config.js';
import { collection, doc, setDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    // Tabs logic
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
        });
    });

    // Drag and Drop logic
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    dropZone.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
    });

    dropZone.addEventListener('drop', handleDrop, false);
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    }

    let currentCsvText = null;

    function handleFiles(files) {
        if (files.length === 0) return;
        const file = files[0];

        const fileNameDisplay = document.getElementById('fileNameDisplay');
        if (fileNameDisplay) {
            fileNameDisplay.textContent = `✅ 添付済み: ${file.name}`;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            currentCsvText = e.target.result;
            const tsvText = document.getElementById('dataInput').value;
            const stockPrice = parseFloat(document.getElementById('stockPrice').value);
            processData(currentCsvText, tsvText, stockPrice);
        };
        reader.readAsText(file);
    }

// TSV Textarea logic
const analyzeBtn = document.getElementById('analyzeBtn');
const dataInput = document.getElementById('dataInput');
analyzeBtn.addEventListener('click', () => {
    const tsvText = dataInput.value;
    const stockPrice = parseFloat(document.getElementById('stockPrice').value);
    if (currentCsvText) {
        processData(currentCsvText, tsvText, stockPrice);
    } else {
        alert('先に左側のエリアにCSVファイルをドロップするか選択してください。');
    }
});

    // Firebase Load
    const refreshSavedBtn = document.getElementById('refreshSavedBtn');
    if (refreshSavedBtn) {
        refreshSavedBtn.addEventListener('click', loadSavedStocks);
    }

    // Initial load
    loadSavedStocks();
    renderCriteria();
});

// ==========================================
// Data Processing Logic
// ==========================================
async function processData(csvText, tsvText, stockPrice) {
    try {
        const parsed = parseCsvBlocks(csvText);
        if (Object.keys(parsed.data).length === 0) {
            alert('有効なデータが抽出できませんでした。CSVの形式を確認してください。');
            return;
        }

        // TSV Text Merge (Prioritize TSV dividend data)
        if (tsvText && tsvText.trim()) {
            const parsedTsv = parseTsvData(tsvText);
            mergeTsvIntoCsv(parsed.data, parsedTsv);
        }

        const scores = calculateCsvScores(parsed.data, stockPrice);
        displayCsvResults(parsed.stockName, parsed.data, scores);

        // Save to Firebase
        await saveStockToFirebase(parsed.stockName, parsed.data, scores);
    } catch (e) {
        console.error(e);
        alert('解析中にエラーが発生しました。');
    }
}

function parseCsvBlocks(text) {
    const lines = text.split('\n').map(l => l.trim());
    let stockName = "";
    const parsed = {}; // year -> { EPS, ROE, Sales, Dividend... }

    let currentBlock = null;
    let headers = [];

    for (let line of lines) {
        if (!line) continue;

        // Stock Name like "9433 KDDI"
        if (line.startsWith('"') && !line.includes(',')) {
            stockName = line.replace(/"/g, '');
            continue;
        }

        if (["業績", "財務", "CF", "配当"].includes(line)) {
            currentBlock = line;
            headers = [];
            continue;
        }

        if (currentBlock && headers.length === 0) {
            headers = line.split(',');
            continue;
        }

        if (currentBlock && headers.length > 0) {
            const cols = line.split(',');
            // Extract Year like 2022/03
            const yearMatch = cols[0].match(/^(\d{4})\/\d{2}/);
            if (yearMatch) {
                const year = parseInt(yearMatch[1], 10);
                if (!parsed[year]) parsed[year] = { year: year, isActual: true };

                // If it contains "（予想）", mark as forecast
                if (line.includes('（予想）')) {
                    parsed[year].isActual = false;
                }

                for (let i = 1; i < headers.length; i++) {
                    if (i < cols.length) {
                        const valStr = cols[i].replace(/"/g, '');
                        if (valStr !== '-' && valStr !== '') {
                            const num = parseFloat(valStr.replace(/,/g, ''));
                            if (!isNaN(num)) {
                                parsed[year][headers[i]] = num;
                            }
                        }
                    }
                }
            }
        }
    }

    return { stockName, data: Object.values(parsed).sort((a, b) => b.year - a.year) };
}

function calculateCsvScores(data, stockPrice) {
    const actuals = data.filter(d => d.isActual);
    const forecasts = data.filter(d => !d.isActual);

    // ⑤ ROE 5年平均 (actuals only)
    let roeAvg = null;
    let roeScore = 0;
    const roeData = actuals.filter(d => d.ROE !== undefined).slice(0, 5);
    if (roeData.length > 0) {
        const sum = roeData.reduce((acc, curr) => acc + curr.ROE, 0);
        roeAvg = sum / roeData.length;
        roeScore = getRoeScore(roeAvg);
    }

    // ⑦ 売上高CAGR (actuals only, up to 5 years diff)
    let salesCagr = null;
    let salesScore = 0;
    const salesData = actuals.filter(d => d.売上高 !== undefined);
    if (salesData.length >= 2) {
        const recent = salesData[0];
        // Take the oldest available up to 5 years ago
        const maxYearsToLookBack = Math.min(5, salesData.length - 1);
        const old = salesData[maxYearsToLookBack];

        const yearsDiff = recent.year - old.year;
        if (yearsDiff > 0 && old.売上高 > 0) {
            salesCagr = Math.pow((recent.売上高 / old.売上高), 1 / yearsDiff) - 1;
            salesScore = getCagrScore(salesCagr); // 閾値は同じ
        }
    }

    // ④ EPS CAGR (actuals only, up to 5 years diff)
    let epsCagr = null;
    let epsScore = 0;
    const epsData = actuals.filter(d => d.EPS !== undefined);
    if (epsData.length >= 2) {
        const recent = epsData[0];
        const maxYearsToLookBack = Math.min(5, epsData.length - 1);
        const old = epsData[maxYearsToLookBack];

        const yearsDiff = recent.year - old.year;
        if (yearsDiff > 0 && old.EPS > 0) {
            epsCagr = Math.pow((recent.EPS / old.EPS), 1 / yearsDiff) - 1;
            epsScore = getCagrScore(epsCagr); // 閾値は同じ
        }
    }

    // ③ 予想配当性向
    let payoutRatio = null;
    let payoutScore = 0;
    const forecasts = data.filter(d => !d.isActual);
    if (forecasts.length > 0) {
        const latestForecast = forecasts[0];
        if (latestForecast.EPS && latestForecast.一株配当) {
            payoutRatio = (latestForecast.一株配当 / latestForecast.EPS);
            payoutScore = getPayoutRatioScore(payoutRatio);
        }
    } else if (actuals.length > 0) {
        // Fallback to latest actual if no forecast
        const latestActual = actuals[0];
        if (latestActual.EPS && latestActual.一株配当) {
            payoutRatio = (latestActual.一株配当 / latestActual.EPS);
            payoutScore = getPayoutRatioScore(payoutRatio);
        }
    }

    // ① 直近5年間の増配率 (CAGR)
    let divCagr = null;
    let divCagrScore = 0;
    const divData = actuals.filter(d => d.一株配当 !== undefined);
    if (divData.length >= 2) {
        const recent = divData[0];
        const maxYearsToLookBack = Math.min(5, divData.length - 1);
        const old = divData[maxYearsToLookBack];
        const yearsDiff = recent.year - old.year;
        if (yearsDiff > 0 && old.一株配当 > 0) {
            divCagr = Math.pow((recent.一株配当 / old.一株配当), 1 / yearsDiff) - 1;
            divCagrScore = getDividendCagrScore(divCagr);
        }
    }

    // ② 連続非減配年数
    let nonDecYears = 0;
    let nonDecScore = 0;
    if (divData.length >= 2) {
        for (let i = 0; i < divData.length - 1; i++) {
            if (divData[i].一株配当 >= divData[i+1].一株配当) {
                nonDecYears++;
            } else {
                break;
            }
        }
        nonDecScore = getNonDecreasingDividendYearsScore(nonDecYears);
    }

    // ⑧ 営業利益率5年平均
    let opMarginAvg = null;
    let opMarginScore = 0;
    let marginData = [];
    for (let d of actuals) {
        if (d.営業利益率 !== undefined) {
            marginData.push(d.営業利益率 / 100);
        } else if (d.営業利益 !== undefined && d.売上高 !== undefined && d.売上高 > 0) {
            marginData.push(d.営業利益 / d.売上高);
        }
    }
    const marginData5y = marginData.slice(0, 5);
    if (marginData5y.length > 0) {
        const sum = marginData5y.reduce((acc, curr) => acc + curr, 0);
        opMarginAvg = sum / marginData5y.length;
        opMarginScore = getOpMarginAvgScore(opMarginAvg);
    }

    // ⑩ 配当利回り
    let divYield = null;
    let divYieldScore = 0;
    if (stockPrice > 0) {
        let annualDividend = 0;
        // 予想があれば優先
        if (forecasts.length > 0 && forecasts[0].一株配当) {
            annualDividend = forecasts[0].一株配当;
        } else if (actuals.length > 0 && actuals[0].一株配当) {
            annualDividend = actuals[0].一株配当;
        }
        
        if (annualDividend > 0) {
            divYield = (annualDividend / stockPrice);
            divYieldScore = getDividendYieldScore(divYield);
        }
    }

    return {
        roe: { value: roeAvg, score: roeScore },
        sales: { value: salesCagr, score: salesScore },
        eps: { value: epsCagr, score: epsScore },
        payout: { value: payoutRatio, score: payoutScore },
        divCagr: { value: divCagr, score: divCagrScore },
        nonDecYears: { value: nonDecYears, score: nonDecScore },
        opMargin: { value: opMarginAvg, score: opMarginScore },
        divYield: { value: divYield, score: divYieldScore }
    };
}

// ==========================================
// Score Renderers
// ==========================================

function displayCsvResults(stockName, data, scores) {
    document.getElementById('resultsSection').classList.remove('hidden');

    const titleEl = document.getElementById('stockNameHeader');
    titleEl.textContent = stockName ? stockName + " のスコア解析" : "銘柄スコア解析";
    titleEl.style.display = 'block';

    const container = document.getElementById('scoreCardsContainer');
    container.innerHTML = ''; // clear

    // ROE
    container.innerHTML += createCardHTML(
        "ROEの5年平均",
        scores.roe.value !== null ? scores.roe.value.toFixed(2) + '%' : '--',
        scores.roe.score
    );
    // Sales CAGR
    container.innerHTML += createCardHTML(
        "売上高CAGR",
        scores.sales.value !== null ? (scores.sales.value * 100).toFixed(2) + '%' : '--',
        scores.sales.score
    );
    // EPS CAGR
    container.innerHTML += createCardHTML(
        "EPSのCAGR",
        scores.eps.value !== null ? (scores.eps.value * 100).toFixed(2) + '%' : '--',
        scores.eps.score
    );
    // Payout Ratio
    container.innerHTML += createCardHTML(
        "予想配当性向",
        scores.payout.value !== null ? (scores.payout.value * 100).toFixed(2) + '%' : '--',
        scores.payout.score
    );
    // Dividend CAGR
    container.innerHTML += createCardHTML(
        "増配率(CAGR)", 
        scores.divCagr.value !== null ? (scores.divCagr.value * 100).toFixed(2) + '%' : '--', 
        scores.divCagr.score
    );
    // Non-Decreasing Years
    container.innerHTML += createCardHTML(
        "連続非減配年数", 
        scores.nonDecYears.value !== null ? scores.nonDecYears.value + '年' : '--', 
        scores.nonDecYears.score
    );
    // Operating Margin Avg
    container.innerHTML += createCardHTML(
        "営業利益率平均", 
        scores.opMargin.value !== null ? (scores.opMargin.value * 100).toFixed(2) + '%' : '--', 
        scores.opMargin.score
    );
    // Dividend Yield
    container.innerHTML += createCardHTML(
        "配当利回り", 
        scores.divYield.value !== null ? (scores.divYield.value * 100).toFixed(2) + '%' : '--', 
        scores.divYield.score
    );

    // Table
    const tbody = document.querySelector('#parsedTable tbody');
    tbody.innerHTML = '';
    data.forEach(row => {
        const tr = document.createElement('tr');
        const isActualMark = row.isActual ? '<span style="color:#34d399;font-size:0.8em;margin-left:8px;">[実績]</span>' : '<span style="color:#fb923c;font-size:0.8em;margin-left:8px;">[予想]</span>';

        const div = row.一株配当 ? row.一株配当.toFixed(2) : '-';
        const eps = row.EPS ? row.EPS.toFixed(2) : '-';
        const roe = row.ROE ? row.ROE.toFixed(2) + '%' : '-';
        const sales = row.売上高 ? row.売上高.toLocaleString() : '-';

        tr.innerHTML = `
            <td>${row.year}年 ${isActualMark}</td>
            <td>${div}</td>
            <td>${eps}</td>
            <td>${roe}</td>
            <td>${sales}</td>
        `;
        tbody.appendChild(tr);
    });
}

function createCardHTML(title, valueStr, score) {
    return `
    <div class="score-card glass-panel" data-score="${score}">
        <h3>${title}</h3>
        <div class="value">${valueStr}</div>
        <div class="score">${score} pts</div>
    </div>
    `;
}

// ==========================================
// TSV Logic (Dividend History Parsing)
// ==========================================
function parseTsvData(tsvText) {
    const lines = tsvText.split('\n');
    const parsed = [];
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;
        
        // Handle line breaks within a single row (e.g. "2010年" \n "3月\t実績...")
        if (line.match(/^\d{4}年$/) && i + 1 < lines.length) {
            line = line + lines[i+1].trim();
            i++; 
        }

        const cols = line.split('\t');
        if (cols.length >= 6) {
            const yearMatch = cols[0].match(/^(\d{4})年/);
            if (yearMatch) {
                const year = parseInt(yearMatch[1], 10);
                const isActual = cols[1] === '実績';
                // 6th column (index 5) is usually 分割調整配当
                const divStr = cols[5].replace(/,/g, '').replace(/[^\d.-]/g, '');
                const divValue = parseFloat(divStr);
                if (!isNaN(divValue)) {
                    parsed.push({ year, isActual, 一株配当: divValue });
                }
            }
        }
    }
    return parsed.sort((a, b) => b.year - a.year);
}

function mergeTsvIntoCsv(csvData, tsvData) {
    tsvData.forEach(tsvRow => {
        let csvRow = csvData.find(c => c.year === tsvRow.year);
        if (csvRow) {
            csvRow.一株配当 = tsvRow.一株配当;
            if (tsvRow.isActual !== undefined) {
                csvRow.isActual = tsvRow.isActual;
            }
        } else {
            csvData.push({
                year: tsvRow.year,
                isActual: tsvRow.isActual,
                一株配当: tsvRow.一株配当
            });
        }
    });
    // Re-sort descending
    csvData.sort((a, b) => b.year - a.year);
}

// ==========================================
// Scoring Tables Logic
// ==========================================

function getRoeScore(avgRoe) {
    if (avgRoe >= 15) return 10;
    if (avgRoe >= 12) return 9;
    if (avgRoe >= 10) return 8;
    if (avgRoe >= 8) return 7;
    if (avgRoe >= 7) return 6;
    if (avgRoe >= 6) return 5;
    if (avgRoe >= 5) return 4;
    if (avgRoe >= 4) return 3;
    if (avgRoe >= 3) return 2;
    if (avgRoe >= 2) return 1;
    return 0;
}

// CAGR uses same thresholds for Dividend, Sales, EPS
function getCagrScore(cagr) {
    const pct = cagr * 100;
    if (pct >= 20) return 10; // Sales/EPS require 20% for 10pts, Dividend requires 30%. I'll use 20% as required by markdown for Sales/EPS.
    if (pct >= 16) return 9;
    if (pct >= 14) return 8;
    if (pct >= 12) return 7;
    if (pct >= 10) return 6;
    if (pct >= 8) return 5;
    if (pct >= 6) return 4;
    if (pct >= 4) return 3;
    if (pct >= 2) return 2;
    if (pct > 0) return 1;
    return 0;
}

function getPayoutRatioScore(ratio) {
    const pct = ratio * 100;
    if (pct <= 25) return 10;
    if (pct <= 30) return 9;
    if (pct <= 35) return 8;
    if (pct <= 40) return 7;
    if (pct <= 45) return 6;
    if (pct <= 50) return 5;
    if (pct <= 55) return 4;
    if (pct <= 60) return 3;
    if (pct <= 65) return 2;
    if (pct <= 70) return 1;
    return 0;
}

function getDividendCagrScore(cagr) {
    const pct = cagr * 100;
    if (pct >= 30) return 10;
    if (pct >= 20) return 9;
    if (pct >= 15) return 8;
    if (pct >= 12) return 7;
    if (pct >= 10) return 6;
    if (pct >= 8) return 5;
    if (pct >= 5) return 4;
    if (pct >= 3) return 3;
    if (pct >= 2) return 2;
    if (pct > 0) return 1;
    return 0;
}

function getNonDecreasingDividendYearsScore(years) {
    if (years >= 17) return 10;
    if (years >= 10) return 5;
    if (years >= 5) return 3;
    return 0;
}

function getOpMarginAvgScore(margin) {
    const pct = margin * 100;
    if (pct >= 20) return 10;
    if (pct >= 16) return 9;
    if (pct >= 14) return 8;
    if (pct >= 12) return 7;
    if (pct >= 10) return 6;
    if (pct >= 8) return 5;
    if (pct >= 6) return 4;
    if (pct >= 4) return 3;
    if (pct >= 2) return 2;
    if (pct > 0) return 1;
    return 0;
}

function getDividendYieldScore(divYield) {
    const pct = divYield * 100;
    if (pct >= 5.50) return 10;
    if (pct >= 5.25) return 9;
    if (pct >= 5.00) return 8;
    if (pct >= 4.75) return 7;
    if (pct >= 4.50) return 6;
    if (pct >= 4.25) return 5;
    if (pct >= 4.00) return 4;
    if (pct >= 3.75) return 3;
    if (pct >= 3.50) return 2;
    if (pct >= 3.25) return 1;
    return 0;
}

// ==========================================
// Firebase Logic
// ==========================================

async function saveStockToFirebase(stockName, data, scores) {
    if (!stockName) return; // Cannot save without a name/ticker

    // Extract ticker and name from "9433 KDDI"
    let ticker = stockName;
    let name = stockName;
    const match = stockName.match(/^(\d{4})\s+(.+)$/);
    if (match) {
        ticker = match[1];
        name = match[2];
    }

    try {
        const docRef = doc(db, "stocks", ticker);
        await setDoc(docRef, {
            ticker: ticker,
            companyName: name,
            originalStockName: stockName,
            scores: scores,
            data: data, // Note: storing full array
            updatedAt: new Date().toISOString()
        });
        console.log("Document successfully written!", ticker);
        // Refresh the list
        loadSavedStocks();
    } catch (e) {
        console.error("Error writing document: ", e);
    }
}

let cachedStocks = [];

async function loadSavedStocks() {
    const listContainer = document.getElementById('savedStocksList');
    if (!listContainer) return;

    try {
        const querySnapshot = await getDocs(collection(db, "stocks"));
        cachedStocks = [];
        querySnapshot.forEach((doc) => {
            cachedStocks.push({ id: doc.id, ...doc.data() });
        });

        // Sort by updatedAt descending
        cachedStocks.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

        renderSavedStocks(cachedStocks);
    } catch (e) {
        console.error("Error loading documents: ", e);
        listContainer.innerHTML = `<p style="color: #ef4444;">データの読み込みに失敗しました。Firebaseの設定（apiKeyなど）を確認してください。</p>`;
    }
}

function renderSavedStocks(stocks) {
    const listContainer = document.getElementById('savedStocksList');
    listContainer.innerHTML = '';

    if (stocks.length === 0) {
        listContainer.innerHTML = `<p style="color: #94a3b8;">保存された銘柄はありません。</p>`;
        return;
    }

    stocks.forEach(stock => {
        const dateStr = new Date(stock.updatedAt).toLocaleString('ja-JP');

        // Calculate total score safely
        let totalScore = 0;
        if (stock.scores) {
            if (stock.scores.roe) totalScore += stock.scores.roe.score;
            if (stock.scores.sales) totalScore += stock.scores.sales.score;
            if (stock.scores.eps) totalScore += stock.scores.eps.score;
            if (stock.scores.payout) totalScore += stock.scores.payout.score;
            if (stock.scores.divCagr) totalScore += stock.scores.divCagr.score;
            if (stock.scores.nonDecYears) totalScore += stock.scores.nonDecYears.score;
            if (stock.scores.opMargin) totalScore += stock.scores.opMargin.score;
            if (stock.scores.divYield) totalScore += stock.scores.divYield.score;
        }

        const card = document.createElement('div');
        card.className = 'saved-stock-card';
        card.innerHTML = `
            <div class="stock-title">${stock.ticker} ${stock.companyName}</div>
            <div class="stock-date">更新: ${dateStr}</div>
            <div class="stock-scores">
                <span class="badge" style="background: rgba(59, 130, 246, 0.3);">合計: ${totalScore}</span>
                <span class="badge">ROE: ${stock.scores.roe?.score ?? '-'}</span>
                <span class="badge">売上: ${stock.scores.sales?.score ?? '-'}</span>
                <span class="badge">EPS: ${stock.scores.eps?.score ?? '-'}</span>
                <span class="badge">配当: ${stock.scores.payout?.score ?? '-'}</span>
                <span class="badge">増配: ${stock.scores.divCagr?.score ?? '-'}</span>
                <span class="badge">非減配: ${stock.scores.nonDecYears?.score ?? '-'}</span>
                <span class="badge">営利: ${stock.scores.opMargin?.score ?? '-'}</span>
                <span class="badge">利回り: ${stock.scores.divYield?.score ?? '-'}</span>
            </div>
        `;

        // Click to view details
        card.addEventListener('click', () => {
            displayCsvResults(stock.originalStockName, stock.data, stock.scores);
            // Switch to input tab view
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const inputTabBtn = document.querySelector('[data-target="inputTab"]');
            if (inputTabBtn) inputTabBtn.classList.add('active');
            document.getElementById('inputTab').classList.add('active');

            // Show & Scroll to results
            const resultsSec = document.getElementById('resultsSection');
            if (resultsSec) {
                resultsSec.classList.remove('hidden');
                resultsSec.scrollIntoView({ behavior: 'smooth' });
            }
        });

        listContainer.appendChild(card);
    });
}

// ==========================================
// Criteria Rendering Logic
// ==========================================
const CRITERIA_DATA = [
    {
        id: "1", title: "① 直近5年間の増配率 (CAGR)",
        desc: "計算式: (昨年の配当金 / 5年前の配当金)^(1/5) - 1",
        implemented: true,
        table: [["30%以上", "10"], ["20%～", "9"], ["15%～", "8"], ["12%～", "7"], ["10%～", "6"], ["8%～", "5"], ["5%～", "4"], ["3%～", "3"], ["2%～", "2"], ["0%～", "1"], ["0%以下", "0"]]
    },
    {
        id: "2", title: "② 連続非減配年数",
        desc: "直近から過去18年前まで遡り、前年比で減配していない連続年数。",
        implemented: true,
        table: [["17年以上", "10"], ["10年～", "5"], ["5年～", "3"], ["0年～", "0"]]
    },
    {
        id: "3", title: "③ 予想配当性向",
        desc: "今期予想ベースの配当性向。",
        implemented: true,
        table: [["0%～25%", "10"], ["～30%", "9"], ["～35%", "8"], ["～40%", "7"], ["～45%", "6"], ["～50%", "5"], ["～55%", "4"], ["～60%", "3"], ["～65%", "2"], ["～70%", "1"], ["70%超", "0"]]
    },
    {
        id: "4", title: "④ EPSの5年CAGR",
        desc: "異常値を除外するため、直近3年間の中央値および5年前から遡った3年間の中央値を使用して成長率を算出。",
        implemented: true,
        table: [["20%以上", "10"], ["16%～", "9"], ["14%～", "8"], ["12%～", "7"], ["10%～", "6"], ["8%～", "5"], ["6%～", "4"], ["4%～", "3"], ["2%～", "2"], ["0%～", "1"], ["0%以下", "0"]]
    },
    {
        id: "5", title: "⑤ ROEの5年平均",
        desc: "直近5年間のROEの単純平均。",
        implemented: true,
        table: [["15%以上", "10"], ["12%～", "9"], ["10%～", "8"], ["8%～", "7"], ["7%～", "6"], ["6%～", "5"], ["5%～", "4"], ["4%～", "3"], ["3%～", "2"], ["2%～", "1"], ["0%～", "0"]]
    },
    {
        id: "6", title: "⑥ 配当維持可能年数",
        desc: "ネットキャッシュ / 前期末の配当総額",
        implemented: false,
        table: [["30年以上", "10"], ["20年～", "9"], ["10年～", "8"], ["8年～", "7"], ["6年～", "6"], ["5年～", "5"], ["4年～", "4"], ["3年～", "3"], ["2年～", "2"], ["1年～", "1"], ["0年～", "0"]]
    },
    {
        id: "7", title: "⑦ 売上高5年のCAGR",
        desc: "計算式: (現在の売上高 / 5年前の売上高)^(1/5) - 1",
        implemented: true,
        table: [["20%以上", "10"], ["16%～", "9"], ["14%～", "8"], ["12%～", "7"], ["10%～", "6"], ["8%～", "5"], ["6%～", "4"], ["4%～", "3"], ["2%～", "2"], ["0%～", "1"], ["0%以下", "0"]]
    },
    {
        id: "8", title: "⑧ 営業利益率5年平均",
        desc: "直近5年間の営業利益率の平均値。",
        implemented: true,
        table: [["20%以上", "10"], ["16%～", "9"], ["14%～", "8"], ["12%～", "7"], ["10%～", "6"], ["8%～", "5"], ["6%～", "4"], ["4%～", "3"], ["2%～", "2"], ["0%～", "1"], ["0%以下", "0"]]
    },
    {
        id: "9", title: "⑨ MIX係数",
        desc: "PER (会社予想) × PBR (実績)",
        implemented: false,
        table: [["0～10倍", "10"], ["～12倍", "9"], ["～15倍", "8"], ["～18倍", "7"], ["～22.5倍", "6"], ["～25倍", "5"], ["～27倍", "4"], ["～30倍", "3"], ["～33倍", "2"], ["～40倍", "1"], ["40倍超", "0"]]
    },
    {
        id: "10", title: "⑩ 配当利回り",
        desc: "現在の株価に対する年間配当金の割合。",
        implemented: true,
        table: [["5.50%以上", "10"], ["5.25%～", "9"], ["5.00%～", "8"], ["4.75%～", "7"], ["4.50%～", "6"], ["4.25%～", "5"], ["4.00%～", "4"], ["3.75%～", "3"], ["3.50%～", "2"], ["3.25%～", "1"], ["0.00%～", "0"]]
    }
];

function renderCriteria() {
    const container = document.getElementById('criteriaContainer');
    if (!container) return;

    let html = '';
    CRITERIA_DATA.forEach(c => {
        const badge = c.implemented
            ? `<span class="badge badge-implemented">自動計算済</span>`
            : `<span class="badge badge-pending">未実装</span>`;

        let tableRows = c.table.map(row => `<tr><td>${row[0]}</td><td class="pts">${row[1]} pts</td></tr>`).join('');

        html += `
        <div class="criteria-card glass-panel">
            <div class="criteria-card-header">
                <h3>${c.title} ${badge}</h3>
            </div>
            <div class="criteria-card-body">
                <p class="criteria-desc">${c.desc}</p>
                <div class="table-container">
                    <table class="criteria-table">
                        <tr><th>条件</th><th>点数</th></tr>
                        ${tableRows}
                    </table>
                </div>
            </div>
        </div>
        `;
    });
    container.innerHTML = html;
}
