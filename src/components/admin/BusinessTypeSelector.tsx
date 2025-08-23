import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Scissors, 
  UtensilsCrossed, 
  Stethoscope, 
  Heart, 
  Flower2, 
  Car,
  Building2
} from 'lucide-react';

const BUSINESS_TYPES = [
  {
    id: 'salon',
    name: 'Beauty Salon / Spa',
    description: 'Hair salons, nail salons, beauty spas with full service expertise',
    icon: Scissors,
    features: ['Hair services', 'Beauty treatments', 'Booking management', 'Product recommendations'],
    color: 'bg-pink-100 text-pink-800'
  },
  {
    id: 'restaurant',
    name: 'Restaurant / Cafe',
    description: 'Dining establishments, cafes, food service businesses',
    icon: UtensilsCrossed,
    features: ['Reservation management', 'Menu knowledge', 'Dietary accommodations', 'Special events'],
    color: 'bg-orange-100 text-orange-800'
  },
  {
    id: 'medical',
    name: 'Medical Office',
    description: 'Healthcare providers, clinics, medical practices',
    icon: Stethoscope,
    features: ['Appointment scheduling', 'Insurance verification', 'HIPAA compliance', 'Emergency triage'],
    color: 'bg-blue-100 text-blue-800'
  },
  {
    id: 'dental',
    name: 'Dental Office',
    description: 'Dental practices, orthodontist offices, oral surgeons',
    icon: Heart,
    features: ['Dental procedures', 'Insurance handling', 'Anxiety management', 'Treatment planning'],
    color: 'bg-green-100 text-green-800'
  },
  {
    id: 'spa',
    name: 'Day Spa / Wellness',
    description: 'Wellness centers, massage therapy, holistic health',
    icon: Flower2,
    features: ['Wellness consultations', 'Treatment packages', 'Relaxation focus', 'Gift services'],
    color: 'bg-purple-100 text-purple-800'
  },
  {
    id: 'automotive',
    name: 'Auto Service / Repair',
    description: 'Auto repair shops, maintenance centers, car dealerships',
    icon: Car,
    features: ['Service scheduling', 'Diagnostic expertise', 'Parts availability', 'Warranty handling'],
    color: 'bg-gray-100 text-gray-800'
  }
];

interface BusinessTypeSelectorProps {
  selectedType: string;
  onSelect: (type: string) => void;
  className?: string;
}

export default function BusinessTypeSelector({ selectedType, onSelect, className = '' }: BusinessTypeSelectorProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      <div>
        <h3 className="text-lg font-semibold mb-2">Select Business Type</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Choose the business type to get a pre-trained AI agent with industry-specific knowledge
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {BUSINESS_TYPES.map((type) => {
          const IconComponent = type.icon;
          const isSelected = selectedType === type.id;
          
          return (
            <Card 
              key={type.id}
              className={`cursor-pointer transition-all hover:shadow-md ${
                isSelected ? 'ring-2 ring-primary border-primary' : ''
              }`}
              onClick={() => onSelect(type.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <IconComponent className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{type.name}</CardTitle>
                    </div>
                  </div>
                  {isSelected && (
                    <Badge variant="default" className="ml-2">Selected</Badge>
                  )}
                </div>
                <CardDescription className="text-sm">
                  {type.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">AI Agent Features:</div>
                  <div className="flex flex-wrap gap-1">
                    {type.features.map((feature, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {feature}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      
      {!selectedType && (
        <div className="text-center py-4">
          <Building2 className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Don't see your business type? Select the closest match - you can customize the AI agent later.
          </p>
        </div>
      )}
    </div>
  );
}