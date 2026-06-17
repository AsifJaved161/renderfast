import { redirect } from 'next/navigation'

// Authenticated users land on the dashboard; middleware sends them to /login if not.
export default function Home() {
  redirect('/dashboard')
}
