'use client';
import { useParams } from 'next/navigation';
import { asLocale } from '@/lib/i18n';
import { DiscoveryUnavailable } from '@/components/discovery-post';
export default function NotFound() {
  return <DiscoveryUnavailable locale={asLocale(useParams<{ locale: string }>().locale)} missing />;
}
