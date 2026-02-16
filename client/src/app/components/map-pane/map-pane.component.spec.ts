import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MapPaneComponent } from './map-pane.component';

describe('MapPaneComponent', () => {
  let component: MapPaneComponent;
  let fixture: ComponentFixture<MapPaneComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapPaneComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MapPaneComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
