import React from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  TrendingUp, 
  Clock, 
  Globe, 
  Award, 
  Users, 
  DollarSign,
  BarChart3,
  CheckCircle,
  ArrowRight
} from "lucide-react";
import dashboardPreview from "@/assets/dashboard-preview.jpg";

export default function MarketingShowcase() {
  const stats = [
    { value: "98.7%", label: "Call Success Rate", icon: CheckCircle, color: "text-green-600" },
    { value: "< 2s", label: "Avg Response Time", icon: Clock, color: "text-blue-600" },
    { value: "24/7", label: "Availability", icon: Globe, color: "text-purple-600" },
    { value: "$2.4M+", label: "Revenue Generated", icon: DollarSign, color: "text-emerald-600" },
  ];

  const benefits = [
    {
      title: "87% Cost Reduction",
      description: "Compared to hiring full-time receptionist staff",
      icon: TrendingUp,
    },
    {
      title: "3x More Bookings",
      description: "Capture after-hours and weekend opportunities",
      icon: BarChart3,
    },
    {
      title: "Industry-Specific",
      description: "Pre-trained for salons, auto shops, med spas, and more",
      icon: Award,
    },
    {
      title: "Unlimited Scale",
      description: "Handle hundreds of concurrent calls simultaneously",
      icon: Users,
    },
  ];

  return (
    <section className="px-4 py-24 bg-muted/20">
      <div className="max-w-7xl mx-auto">
        {/* Hero Stats */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/50 text-accent-foreground text-sm font-medium mb-6">
            <Award className="w-4 h-4" />
            Proven Results
          </div>
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            Transforming businesses
            <span className="bg-[image:var(--gradient-primary)] bg-clip-text text-transparent">
              {" "}one call at a time
            </span>
          </h2>
        </motion.div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-20">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1, duration: 0.6 }}
              viewport={{ once: true }}
              className="text-center p-6 rounded-3xl bg-card shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-premium)] transition-all duration-300 hover:scale-105"
            >
              <stat.icon className={`w-8 h-8 mx-auto mb-4 ${stat.color}`} />
              <div className="text-3xl font-bold mb-2">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </motion.div>
          ))}
        </div>

        {/* Benefits Section */}
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="space-y-8"
          >
            <div>
              <h3 className="text-3xl font-bold mb-4">
                Why businesses choose Voice Relay Pro
              </h3>
              <p className="text-xl text-muted-foreground mb-8">
                Join thousands of businesses already using Voice Relay Pro to capture more leads, 
                book more appointments, and never miss an opportunity.
              </p>
            </div>

            <div className="space-y-6">
              {benefits.map((benefit, index) => (
                <motion.div
                  key={benefit.title}
                  initial={{ opacity: 0, x: -30 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1, duration: 0.6 }}
                  viewport={{ once: true }}
                  className="flex gap-4 p-6 rounded-2xl bg-card/50 hover:bg-card transition-all duration-300"
                >
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-[image:var(--gradient-primary)] text-white grid place-items-center">
                    <benefit.icon className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-lg font-semibold mb-2">{benefit.title}</h4>
                    <p className="text-muted-foreground">{benefit.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            <Button 
              size="lg" 
              className="rounded-2xl bg-[image:var(--gradient-primary)] hover:scale-105 transition-transform duration-300 shadow-[var(--shadow-premium)]"
            >
              Start Your Free Trial
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="relative"
          >
            <div className="relative rounded-3xl overflow-hidden shadow-[var(--shadow-premium)]">
              <img 
                src={dashboardPreview} 
                alt="Voice Relay Pro Dashboard Preview" 
                className="w-full h-auto"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
              
              {/* Floating testimonial */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5, duration: 0.6 }}
                viewport={{ once: true }}
                className="absolute bottom-6 left-6 right-6 bg-card/90 backdrop-blur-sm rounded-2xl p-6 shadow-lg"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-[image:var(--gradient-primary)] flex items-center justify-center text-white font-semibold">
                    S
                  </div>
                  <div>
                    <div className="font-semibold">Sarah Johnson</div>
                    <div className="text-sm text-muted-foreground">Salon Owner</div>
                  </div>
                </div>
                <p className="text-sm italic">
                  "Voice Relay Pro increased our bookings by 40% in the first month. 
                  It's like having a perfect receptionist who never sleeps."
                </p>
              </motion.div>
            </div>

            {/* Background glow */}
            <div className="absolute inset-0 bg-[image:var(--gradient-primary)] opacity-20 blur-3xl -z-10" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}