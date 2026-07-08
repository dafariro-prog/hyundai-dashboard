// Configuración pública de Supabase (la anon key es segura en el cliente; la protección la dan las RLS)
const SB_URL = 'https://ioumqovyirtwqjrbseqt.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvdW1xb3Z5aXJ0d3FqcmJzZXF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNjYyOTUsImV4cCI6MjA5Nzc0MjI5NX0.DKSjHp67AXvyB8ZZ1148PYNN4mOXfX_zTqKWZeJdSt0';
const sb = window.supabase.createClient(SB_URL, SB_KEY);
