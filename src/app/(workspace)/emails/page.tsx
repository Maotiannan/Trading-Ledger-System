import { redirect } from 'next/navigation';
export default function EmailsRoutePage() { redirect('/notifications?channel=email'); }
