
// netlify/functions/localities.js
exports.handler = async () => {
  const data = {
    "Outra": "#9CA3AF", "Barcelos": "#F87171", "Braga": "#34D399", "Esposende": "#22D3EE",
    "Famalicão": "#7E22CE", "Guimarães": "#FACC15", "Póvoa de Lanhoso": "#A78BFA",
    "Póvoa de Varzim": "#6EE7B7", "Riba D'Ave": "#FBBF24", "Trofa": "#C084FC",
    "Vieira do Minho": "#93C5FD", "Vila do Conde": "#1E3A8A", "Vila Verde": "#86EFAC"
  };
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  };
};
