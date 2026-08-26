// src/lib/server/otel.ts
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';

const OTEL_ENDPOINT =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
  'http://workstation-otel-collector.workstations.svc.cluster.local:4318';

let _provider: MeterProvider | null = null;

function getProvider(): MeterProvider {
  if (!_provider) {
    const exporter = new OTLPMetricExporter({
      url: `${OTEL_ENDPOINT}/v1/metrics`,
      // Don't let export failures crash the server
      timeoutMillis: 5000,
    });
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 15_000,
    });
    _provider = new MeterProvider({
      resource: resourceFromAttributes({ 'service.name': 'doable' }),
      readers: [reader],
    });
  }
  return _provider;
}

export function getMeter() {
  return getProvider().getMeter('doable', '1.0.0');
}
