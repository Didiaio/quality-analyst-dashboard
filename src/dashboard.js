const METRIC_CONFIGS = [
    { key: "Renewals", label: "Renewals", icon: "fa-arrows-rotate", color: "sky", target: "90%" },
    { key: "Amendments", label: "Amendments", icon: "fa-file-signature", color: "indigo", target: "90%" },
    { key: "Vulnerable Customers", label: "Vulnerable Cust.", icon: "fa-shield-halved", color: "amber", target: "95%" },
    { key: "Complaints", label: "Complaints QA", icon: "fa-comment", color: "rose", target: "95%" },
    { key: "BCTU", label: "BCTU Testing", icon: "fa-microscope", color: "purple", target: "95%" },
    { key: "Remedial Actions", label: "Remedial Actions", icon: "fa-square-check", color: "emerald", target: "95%" }
];

let performanceChartInstance = null;
let impactChartInstance = null;
let analystChartInstance = null;

document.addEventListener("DOMContentLoaded", () => {
    refreshData(false);
});

function applyFilters() {
    const dateFilter = document.getElementById("filter-date").value;
    const metricFilter = document.getElementById("filter-metric").value;
    const teamFilter = document.getElementById("filter-team").value;
    const brandFilter = document.getElementById("filter-brand").value;
    const teamLeaderFilter = document.getElementById("filter-teamleader").value;
    const analystFilter = document.getElementById("filter-analyst").value;

    let filtered = [...window.dashboardData];

    if (dateFilter === 'today') {
        const today = new Date().toISOString().split('T')[0];
        filtered = filtered.filter(item => item.date === today);
    } else if (dateFilter === '7days') {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 6);
        const dayValue = cutoff.toISOString().split('T')[0];
        filtered = filtered.filter(item => item.date >= dayValue);
    } else if (dateFilter === '30days') {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 29);
        const dayValue = cutoff.toISOString().split('T')[0];
        filtered = filtered.filter(item => item.date >= dayValue);
    }

    if (metricFilter !== 'all') {
        filtered = filtered.filter(item => item.metric === metricFilter);
    }
    if (teamFilter !== 'all') {
        filtered = filtered.filter(item => item.team === teamFilter);
    }
    if (brandFilter !== 'all') {
        filtered = filtered.filter(item => (item.brand || 'Bright Insurance') === brandFilter);
    }
    if (teamLeaderFilter !== 'all') {
        filtered = filtered.filter(item => (item.teamLeader || item.analyst) === teamLeaderFilter);
    }
    if (analystFilter !== 'all') {
        filtered = filtered.filter(item => item.analyst === analystFilter);
    }

    renderKPICards(filtered);
    renderAlerts(filtered);
    renderCharts(filtered);
    renderOutcomesTable(filtered);
}

function renderKPICards(data) {
    const container = document.getElementById("kpi-cards-container");
    container.innerHTML = "";

    METRIC_CONFIGS.forEach(cfg => {
        const metricData = data.filter(d => d.metric === cfg.key);
        const count = metricData.length;
        const avgScore = count > 0
            ? (metricData.reduce((acc, curr) => acc + curr.score, 0) / count).toFixed(1)
            : "N/A";

        const isPositive = avgScore === "N/A" || parseFloat(avgScore) >= 90;
        const badgeColor = isPositive ? "text-emerald-600 bg-emerald-50" : "text-rose-600 bg-rose-50";
        const arrow = isPositive ? "fa-arrow-up" : "fa-arrow-down";

        const cardHTML = `
            <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between hover:border-slate-300 transition">
                <div>
                    <div class="flex justify-between items-center mb-2">
                        <span class="text-xs font-semibold text-slate-500 truncate">${cfg.label}</span>
                        <div class="p-2 rounded-lg bg-${cfg.color}-50 text-${cfg.color}-600 text-xs">
                            <i class="fa-solid ${cfg.icon}"></i>
                        </div>
                    </div>
                    <div class="text-xl font-bold text-slate-800">${avgScore}%</div>
                </div>
                <div class="mt-3 pt-2 border-t border-slate-100 flex justify-between items-center text-[10px]">
                    <span class="text-slate-400">Target: ${cfg.target}</span>
                    <span class="font-bold ${badgeColor} px-1.5 py-0.5 rounded flex items-center gap-1">
                        <i class="fa-solid ${arrow}"></i> ${count} Audits
                    </span>
                </div>
            </div>
        `;
        container.innerHTML += cardHTML;
    });
}

function renderAlerts(data) {
    const alertsContainer = document.getElementById("alerts-container");
    alertsContainer.innerHTML = "";

    const alertItems = [...data]
        .filter(d => ["Critical", "High"].includes(d.severity) || d.score < 80)
        .sort((a, b) => {
            const severityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
            return (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
        });

    if (alertItems.length > 0) {
        alertItems.forEach(item => {
            const title = item.severity === "Critical" ? "Critical Quality Threshold Breach" : item.severity === "High" ? "High Risk Audit Intervention" : "Below Target Quality Benchmark";
            const alertHTML = `
                <div class="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs flex items-center justify-between shadow-sm">
                    <div class="flex items-center space-x-2">
                        <i class="fa-solid fa-circle-exclamation text-rose-600 text-sm"></i>
                        <span><strong>${title}:</strong> ${item.metric} audit for <strong>${item.analyst}</strong> scored <span class="font-bold underline">${item.score}%</span> (${item.markdownReason}).</span>
                    </div>
                    <button onclick="filterToAnalyst('${item.analyst}')" class="text-[10px] bg-rose-600 hover:bg-rose-700 text-white font-semibold px-2.5 py-1 rounded">Isolate Agent</button>
                </div>
            `;
            alertsContainer.innerHTML += alertHTML;
        });
    }
}

function filterToAnalyst(analystName) {
    document.getElementById("filter-analyst").value = analystName;
    applyFilters();
}

function renderCharts(data) {
    const ctx1 = document.getElementById("performanceChart").getContext("2d");
    if (performanceChartInstance) performanceChartInstance.destroy();

    const dates = [...new Set(data.map(d => d.date))].sort();
    const scoresByDate = dates.map(d => {
        const dayItems = data.filter(i => i.date === d);
        return (dayItems.reduce((acc, c) => acc + c.score, 0) / dayItems.length).toFixed(1);
    });

    performanceChartInstance = new Chart(ctx1, {
        type: 'line',
        data: {
            labels: dates.length ? dates : ["No Data"],
            datasets: [{
                label: 'Quality Score Average (%)',
                data: scoresByDate.length ? scoresByDate : [0],
                borderColor: '#0284c7',
                backgroundColor: 'rgba(2, 132, 199, 0.1)',
                fill: true,
                tension: 0.3,
                borderWidth: 2,
                pointRadius: 4,
                pointBackgroundColor: '#0284c7'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { min: 60, max: 100, grid: { color: '#f1f5f9' } },
                x: { grid: { display: false } }
            }
        }
    });

    const ctx2 = document.getElementById("impactChart").getContext("2d");
    if (impactChartInstance) impactChartInstance.destroy();

    const markdownCounts = {};
    data.forEach(d => {
        if (d.markdownReason !== "None") {
            markdownCounts[d.markdownReason] = (markdownCounts[d.markdownReason] || 0) + 1;
        }
    });

    const labels2 = Object.keys(markdownCounts);
    const counts2 = Object.values(markdownCounts);

    impactChartInstance = new Chart(ctx2, {
        type: 'doughnut',
        data: {
            labels: labels2.length ? labels2 : ["No Markdowns"],
            datasets: [{
                data: counts2.length ? counts2 : [1],
                backgroundColor: ['#f43f5e', '#fbbf24', '#3b82f6', '#a855f7', '#64748b']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }
        }
    });

    const ctx3 = document.getElementById("analystChart").getContext("2d");
    if (analystChartInstance) analystChartInstance.destroy();

    const agents = [...new Set(data.map(d => d.analyst).filter(Boolean))].sort();
    const agentScores = agents.map(name => {
        const items = data.filter(d => d.analyst === name);
        return items.length ? (items.reduce((a, b) => a + b.score, 0) / items.length).toFixed(1) : 0;
    });

    analystChartInstance = new Chart(ctx3, {
        type: 'bar',
        data: {
            labels: agents.length ? agents : ["No Agent Data"],
            datasets: [{
                label: 'Average Score (%)',
                data: agents.length ? agentScores : [0],
                backgroundColor: ['#38bdf8', '#818cf8', '#34d399', '#fbbf24', '#f472b6', '#94a3b8'],
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { min: 50, max: 100, grid: { color: '#f1f5f9' } },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderOutcomesTable(data) {
    const tbody = document.getElementById("outcomes-table-body");
    const isolatedCountElem = document.getElementById("isolated-count");
    tbody.innerHTML = "";

    isolatedCountElem.innerText = data.length;

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400">No records found matching current filter criteria.</td></tr>`;
        return;
    }

    data.forEach(item => {
        let badgeClass = "bg-slate-100 text-slate-600";
        if (item.severity === "Critical") badgeClass = "bg-rose-100 text-rose-700 font-bold";
        else if (item.severity === "High") badgeClass = "bg-amber-100 text-amber-700 font-semibold";
        else if (item.severity === "Medium") badgeClass = "bg-sky-100 text-sky-700";

        const brandLabel = item.brand || 'Customer Service';
        const teamLeaderLabel = item.teamLeader || 'Operations Team';

        const row = `
            <tr class="hover:bg-slate-50 transition">
                <td class="py-3 px-4 font-semibold text-slate-700">${item.metric}</td>
                <td class="py-3 px-4">${item.markdownReason}</td>
                <td class="py-3 px-4 font-mono text-[11px] text-slate-500">${item.id}</td>
                <td class="py-3 px-4">
                    <div class="font-medium text-slate-700">${item.analyst}</div>
                    <div class="text-slate-400 text-[10px]">${teamLeaderLabel} • ${brandLabel}</div>
                </td>
                <td class="py-3 px-4"><span class="px-2 py-0.5 rounded text-[10px] ${badgeClass}">${item.severity}</span></td>
                <td class="py-3 px-4 text-slate-700 font-medium">${item.action}</td>
                <td class="py-3 px-4 text-right">
                    <span class="inline-flex items-center text-emerald-600 text-[11px] font-bold">
                        <i class="fa-solid fa-check-circle mr-1"></i> Logged
                    </span>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

function togglePowerShellDrawer() {
    const drawer = document.getElementById("powershell-drawer");
    drawer.classList.toggle("hidden");
}

function runPowerShellSimulation() {
    const consoleBox = document.getElementById("ps-console");
    const btn = document.getElementById("btn-run-ps");

    consoleBox.classList.remove("hidden");
    consoleBox.innerHTML = `> Executing PowerShell Script: Generate-DataJS.ps1...<br>`;
    btn.disabled = true;
    btn.classList.add("opacity-50");

    setTimeout(() => {
        consoleBox.innerHTML += `> [1/3] Reading file: .\\Exports\\PowerBI_Quality_Export.csv...<br>`;
    }, 400);

    setTimeout(() => {
        consoleBox.innerHTML += `> [2/3] Transforming objects with ConvertTo-Json -Depth 5...<br>`;
    }, 800);

    setTimeout(() => {
        const newId = `QA-${Math.floor(1100 + Math.random() * 900)}`;
        const metrics = ["Renewals", "Amendments", "Vulnerable Customers", "Complaints", "BCTU", "Remedial Actions"];
        const chosenMetric = metrics[Math.floor(Math.random() * metrics.length)];

        const newRecord = {
            id: newId,
            date: new Date().toISOString().split('T')[0],
            metric: chosenMetric,
            team: "Alpha",
            brand: "Bright Insurance",
            teamLeader: "Operations Team",
            analyst: "Sarah Jenkins",
            score: Math.floor(70 + Math.random() * 29),
            target: 95.0,
            markdownReason: "Simulated Script Batch Issue",
            severity: "High",
            action: "PowerShell Injected Automated Audit Item"
        };

        window.dashboardData.unshift(newRecord);

        consoleBox.innerHTML += `<span class="text-emerald-400">> [3/3] Set-Content data.js complete! Injected 1 new audit record (${newId}).</span><br>`;
        btn.disabled = false;
        btn.classList.remove("opacity-50");

        refreshData(true);
    }, 1200);
}

function refreshData(userTriggered = false) {
    applyFilters();
    const timeElem = document.getElementById("last-updated-time");
    const now = new Date();
    timeElem.innerText = `Updated: ${now.toLocaleTimeString()}`;

    if (userTriggered) {
        console.log("Dashboard re-rendered from updated dataset!");
    }
}

function exportReport() {
    const jsonStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(window.dashboardData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", jsonStr);
    downloadAnchor.setAttribute("download", `QA_Dashboard_Export_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}
