// LiveChart.js — streaming line chart for the dashboard
export function LiveChart(props) {
  // @todo: wire to /api/streaming via WebSocket
  return { render: () => '<svg class="live-chart"/>', props };
}
