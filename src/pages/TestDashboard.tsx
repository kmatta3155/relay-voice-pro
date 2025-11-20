import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TestDashboard() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [testResults, setTestResults] = useState<string[]>([]);
  const [currentUrl, setCurrentUrl] = useState(window.location.href);
  const [isTestingNav, setIsTestingNav] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setLoading(false);
    };
    checkSession();
    
    // Update URL display on navigation
    const interval = setInterval(() => {
      setCurrentUrl(window.location.href);
    }, 500);
    
    return () => clearInterval(interval);
  }, []);

  const createDemoSession = async () => {
    setLoading(true);
    setTestResults(prev => [...prev, "Creating demo session..."]);
    
    try {
      // Try to sign in with demo credentials
      const { data, error } = await supabase.auth.signInWithPassword({ 
        email: "demo@voicerelaypro.com", 
        password: "demo123456" 
      });
      
      if (error) {
        // If demo user doesn't exist, create it
        const { error: signupError } = await supabase.auth.signUp({
          email: "demo@voicerelaypro.com",
          password: "demo123456"
        });
        
        if (!signupError) {
          // Try to sign in again
          const { error: signinError } = await supabase.auth.signInWithPassword({
            email: "demo@voicerelaypro.com",
            password: "demo123456"
          });
          
          if (!signinError) {
            setTestResults(prev => [...prev, "✅ Demo user created and signed in"]);
            const { data } = await supabase.auth.getSession();
            setSession(data.session);
          } else {
            setTestResults(prev => [...prev, "❌ Could not sign in demo user"]);
          }
        } else {
          setTestResults(prev => [...prev, "❌ Could not create demo user"]);
        }
      } else {
        setTestResults(prev => [...prev, "✅ Signed in with existing demo user"]);
        setSession(data.session);
      }
    } catch (err) {
      setTestResults(prev => [...prev, `❌ Error: ${err}`]);
    } finally {
      setLoading(false);
    }
  };

  const testNavigation = async () => {
    setIsTestingNav(true);
    setTestResults(prev => [...prev, "Testing navigation..."]);
    
    const routes = [
      { path: '/overview', name: 'Overview' },
      { path: '/appointments', name: 'Appointments' },
      { path: '/leads', name: 'Leads' },
      { path: '/messages', name: 'Messages' },
      { path: '/calls', name: 'Calls' }
    ];
    
    let index = 0;
    const interval = setInterval(() => {
      if (index < routes.length) {
        const route = routes[index];
        setTestResults(prev => [...prev, `Navigating to ${route.name}...`]);
        
        // Check if sidebar active tab is highlighted correctly
        const checkSidebar = () => {
          const sidebarItems = document.querySelectorAll('nav a[href^="/"]');
          let foundActive = false;
          sidebarItems.forEach((item: any) => {
            if (item.href.includes(route.path)) {
              const isHighlighted = item.className.includes('text-white') || 
                                  item.className.includes('bg-[image:var(--gradient-primary)]');
              if (isHighlighted) {
                setTestResults(prev => [...prev, `✅ ${route.name} sidebar item is highlighted`]);
                foundActive = true;
              }
            }
          });
          if (!foundActive) {
            setTestResults(prev => [...prev, `❌ ${route.name} sidebar item NOT highlighted`]);
          }
        };
        
        window.location.href = route.path;
        setTimeout(checkSidebar, 500); // Give time for page to load
        index++;
      } else {
        clearInterval(interval);
        setTestResults(prev => [...prev, "✅ Navigation test complete"]);
        setIsTestingNav(false);
      }
    }, 3000);
  };

  return (
    <div className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-4xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Dashboard Navigation Test</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-blue-50 rounded">
              <p className="font-semibold">Current URL:</p>
              <code className="text-sm">{currentUrl}</code>
            </div>
            
            <div className="p-4 bg-gray-50 rounded">
              <p className="font-semibold">Session Status:</p>
              <p>{loading ? "Loading..." : session ? `✅ Logged in as: ${session.user?.email}` : "❌ Not logged in"}</p>
            </div>
            
            <div className="flex gap-4">
              <Button onClick={createDemoSession} disabled={loading || session}>
                {session ? "Already Logged In" : "Create Demo Session"}
              </Button>
              
              <Button onClick={testNavigation} disabled={!session || isTestingNav}>
                {isTestingNav ? "Testing..." : "Test Navigation"}
              </Button>
              
              <Button onClick={() => window.location.href = '/overview'} disabled={!session}>
                Go to Dashboard
              </Button>
              
              <Button onClick={async () => {
                await supabase.auth.signOut();
                window.location.reload();
              }} variant="outline">
                Sign Out
              </Button>
            </div>
            
            {testResults.length > 0 && (
              <div className="p-4 bg-gray-100 rounded space-y-1">
                <p className="font-semibold">Test Results:</p>
                {testResults.map((result, i) => (
                  <div key={i} className="text-sm">{result}</div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Navigation Links (Requires Authentication)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <a href="/overview" className="p-3 bg-blue-500 text-white text-center rounded hover:bg-blue-600">
                Overview
              </a>
              <a href="/appointments" className="p-3 bg-blue-500 text-white text-center rounded hover:bg-blue-600">
                Appointments
              </a>
              <a href="/leads" className="p-3 bg-blue-500 text-white text-center rounded hover:bg-blue-600">
                Leads
              </a>
              <a href="/messages" className="p-3 bg-blue-500 text-white text-center rounded hover:bg-blue-600">
                Messages
              </a>
              <a href="/calls" className="p-3 bg-blue-500 text-white text-center rounded hover:bg-blue-600">
                Calls
              </a>
              <a href="/settings" className="p-3 bg-blue-500 text-white text-center rounded hover:bg-blue-600">
                Settings
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}